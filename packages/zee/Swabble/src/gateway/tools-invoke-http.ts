import type { IncomingMessage, ServerResponse } from "node:http";

import { createZeeTools } from "../agents/zee-tools.js";
import {
  filterToolsByPolicy,
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveSubagentToolPolicy,
} from "../agents/pi-tools.policy.js";
import {
  buildPluginToolGroups,
  collectExplicitAllowlist,
  expandPolicyWithPluginGroups,
  normalizeToolName,
  resolveToolProfilePolicy,
  stripPluginOnlyAllowlist,
} from "../agents/tool-policy.js";
import { loadConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { logWarn } from "../logger.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";

import { authorizeGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import {
  checkGatewayAuthRateLimit,
  clearGatewayAuthRateLimit,
  recordGatewayAuthFailure,
  resolveGatewayAuthClientIp,
} from "./auth-rate-limit.js";
import { getBearerToken, getHeader } from "./http-utils.js";
import {
  readJsonBodyOrError,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
  sendTooManyRequests,
  sendUnauthorized,
} from "./http-common.js";

const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;

type ToolsInvokeBody = {
  tool?: unknown;
  action?: unknown;
  args?: unknown;
  sessionKey?: unknown;
  dryRun?: unknown;
};

const SESSION_KEY_MAX_LENGTH = 256;
const SESSION_KEY_SAFE_RE = /^[a-zA-Z0-9_:.\-+@]+$/;

function sanitizeSessionKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.length > SESSION_KEY_MAX_LENGTH) {
    throw new Error("Session key too long");
  }
  if (trimmed.includes("\0") || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Session key contains unsafe characters");
  }
  if (!SESSION_KEY_SAFE_RE.test(trimmed)) {
    throw new Error("Session key contains invalid characters");
  }
  return trimmed;
}

function resolveSessionKeyFromBody(body: ToolsInvokeBody): string | undefined {
  if (typeof body.sessionKey === "string" && body.sessionKey.trim()) {
    return sanitizeSessionKey(body.sessionKey);
  }
  return undefined;
}

/**
 * Checks all string values in a flat args object for path traversal sequences.
 * Rejects args containing `..` path components, null bytes, or backslash
 * separators that could escape intended directory boundaries.
 *
 * Also validates URL-like args to block SSRF via internal/private URLs.
 */
const PATH_TRAVERSAL_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
const PATH_ARG_KEYS = new Set(["path", "file", "filepath", "filename", "dir", "directory", "cwd"]);
const URL_ARG_KEYS = new Set(["url", "uri", "endpoint", "href", "link"]);
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "0.0.0.0",
  "metadata.google.internal",
]);

function isBlockedUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  if (hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;
  return false;
}

function getUnsafeArgsError(args: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string") continue;
    if (value.includes("\0")) {
      return `Argument "${key}" contains null byte`;
    }
    const keyLower = key.toLowerCase();
    // Path traversal checks for file-path-like keys.
    if (PATH_ARG_KEYS.has(keyLower) || keyLower.endsWith("path") || keyLower.endsWith("file") || keyLower.endsWith("dir")) {
      if (PATH_TRAVERSAL_RE.test(value)) {
        return `Argument "${key}" contains path traversal sequence`;
      }
    }
    // SSRF checks for URL-like keys.
    if (URL_ARG_KEYS.has(keyLower) || keyLower.endsWith("url") || keyLower.endsWith("uri")) {
      if (isBlockedUrl(value)) {
        return `Argument "${key}" contains a blocked URL`;
      }
    }
  }
  return null;
}

function mergeActionIntoArgsIfSupported(params: {
  toolSchema: unknown;
  action: string | undefined;
  args: Record<string, unknown>;
}): Record<string, unknown> {
  const { toolSchema, action, args } = params;
  if (!action) return args;
  if (args.action !== undefined) return args;
  // TypeBox schemas are plain objects; many tools define an `action` property.
  const schemaObj = toolSchema as { properties?: Record<string, unknown> } | null;
  const hasAction = Boolean(
    schemaObj &&
    typeof schemaObj === "object" &&
    schemaObj.properties &&
    "action" in schemaObj.properties,
  );
  if (!hasAction) return args;
  return { ...args, action };
}

export async function handleToolsInvokeHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { auth: ResolvedGatewayAuth; maxBodyBytes?: number; trustedProxies?: string[] },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/tools/invoke") return false;

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  const cfg = loadConfig();
  const token = getBearerToken(req);
  const rateLimitCfg = cfg.gateway?.auth?.rateLimit;
  const clientIp = resolveGatewayAuthClientIp({
    req,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
  });
  const preLimit = checkGatewayAuthRateLimit({
    cfg: rateLimitCfg,
    ip: clientIp,
    tokenOrPassword: token,
  });
  if (preLimit.limited) {
    sendTooManyRequests(res, preLimit.retryAfterMs);
    return true;
  }
  const authResult = await authorizeGatewayConnect({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
  });
  if (!authResult.ok) {
    const failure = recordGatewayAuthFailure({
      cfg: rateLimitCfg,
      ip: clientIp,
      tokenOrPassword: token,
    });
    if (failure.limited) {
      sendTooManyRequests(res, failure.retryAfterMs);
    } else {
      sendUnauthorized(res);
    }
    return true;
  }
  clearGatewayAuthRateLimit({ ip: clientIp, tokenOrPassword: token });

  const bodyUnknown = await readJsonBodyOrError(req, res, opts.maxBodyBytes ?? DEFAULT_BODY_BYTES);
  if (bodyUnknown === undefined) return true;
  const body = (bodyUnknown ?? {}) as ToolsInvokeBody;

  const toolName = typeof body.tool === "string" ? body.tool.trim() : "";
  if (!toolName) {
    sendInvalidRequest(res, "tools.invoke requires body.tool");
    return true;
  }

  const action = typeof body.action === "string" ? body.action.trim() : undefined;

  const argsRaw = body.args;
  const args = (
    argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
      ? (argsRaw as Record<string, unknown>)
      : {}
  ) as Record<string, unknown>;

  let rawSessionKey: string | undefined;
  try {
    rawSessionKey = resolveSessionKeyFromBody(body);
  } catch (err) {
    // Avoid leaking internal validation details back to remote callers.
    sendInvalidRequest(res, "Invalid session key");
    return true;
  }
  const sessionKey =
    !rawSessionKey || rawSessionKey === "main" ? resolveMainSessionKey(cfg) : rawSessionKey;

  // Resolve message channel/account hints (optional headers) for policy inheritance.
  const messageChannel = normalizeMessageChannel(
    getHeader(req, "x-zee-message-channel") ??
      getHeader(req, "x-zee-message-channel") ??
      getHeader(req, "x-zee-message-channel") ??
      "",
  );
  const accountId =
    getHeader(req, "x-zee-account-id")?.trim() ||
    getHeader(req, "x-zee-account-id")?.trim() ||
    getHeader(req, "x-zee-account-id")?.trim() ||
    undefined;

  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({ config: cfg, sessionKey });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);

  const mergeAlsoAllow = (policy: typeof profilePolicy, alsoAllow?: string[]) => {
    if (!policy?.allow || !Array.isArray(alsoAllow) || alsoAllow.length === 0) return policy;
    return { ...policy, allow: Array.from(new Set([...policy.allow, ...alsoAllow])) };
  };

  const profilePolicyWithAlsoAllow = mergeAlsoAllow(profilePolicy, profileAlsoAllow);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllow(
    providerProfilePolicy,
    providerProfileAlsoAllow,
  );
  const groupPolicy = resolveGroupToolPolicy({
    config: cfg,
    sessionKey,
    messageProvider: messageChannel ?? undefined,
    accountId: accountId ?? null,
  });
  const subagentPolicy = isSubagentSessionKey(sessionKey)
    ? resolveSubagentToolPolicy(cfg)
    : undefined;

  // Build tool list (core + plugin tools).
  const allTools = createZeeTools({
    agentSessionKey: sessionKey,
    agentChannel: messageChannel ?? undefined,
    agentAccountId: accountId,
    config: cfg,
    pluginToolAllowlist: collectExplicitAllowlist([
      profilePolicy,
      providerProfilePolicy,
      globalPolicy,
      globalProviderPolicy,
      agentPolicy,
      agentProviderPolicy,
      groupPolicy,
      subagentPolicy,
    ]),
  });

  const coreToolNames = new Set(
    allTools
      .filter((tool) => !getPluginToolMeta(tool as any))
      .map((tool) => normalizeToolName(tool.name))
      .filter(Boolean),
  );
  const pluginGroups = buildPluginToolGroups({
    tools: allTools,
    toolMeta: (tool) => getPluginToolMeta(tool as any),
  });
  const resolvePolicy = (policy: typeof profilePolicy, label: string) => {
    const resolved = stripPluginOnlyAllowlist(policy, pluginGroups, coreToolNames);
    if (resolved.unknownAllowlist.length > 0) {
      const entries = resolved.unknownAllowlist.join(", ");
      const suffix = resolved.strippedAllowlist
        ? "Ignoring allowlist so core tools remain available. Use tools.alsoAllow for additive plugin tool enablement."
        : "These entries won't match any tool unless the plugin is enabled.";
      logWarn(`tools: ${label} allowlist contains unknown entries (${entries}). ${suffix}`);
    }
    return expandPolicyWithPluginGroups(resolved.policy, pluginGroups);
  };
  const profilePolicyExpanded = resolvePolicy(
    profilePolicyWithAlsoAllow,
    profile ? `tools.profile (${profile})` : "tools.profile",
  );
  const providerProfileExpanded = resolvePolicy(
    providerProfilePolicyWithAlsoAllow,
    providerProfile ? `tools.byProvider.profile (${providerProfile})` : "tools.byProvider.profile",
  );
  const globalPolicyExpanded = resolvePolicy(globalPolicy, "tools.allow");
  const globalProviderExpanded = resolvePolicy(globalProviderPolicy, "tools.byProvider.allow");
  const agentPolicyExpanded = resolvePolicy(
    agentPolicy,
    agentId ? `agents.${agentId}.tools.allow` : "agent tools.allow",
  );
  const agentProviderExpanded = resolvePolicy(
    agentProviderPolicy,
    agentId ? `agents.${agentId}.tools.byProvider.allow` : "agent tools.byProvider.allow",
  );
  const groupPolicyExpanded = resolvePolicy(groupPolicy, "group tools.allow");
  const subagentPolicyExpanded = expandPolicyWithPluginGroups(subagentPolicy, pluginGroups);

  const toolsFiltered = profilePolicyExpanded
    ? filterToolsByPolicy(allTools, profilePolicyExpanded)
    : allTools;
  const providerProfileFiltered = providerProfileExpanded
    ? filterToolsByPolicy(toolsFiltered, providerProfileExpanded)
    : toolsFiltered;
  const globalFiltered = globalPolicyExpanded
    ? filterToolsByPolicy(providerProfileFiltered, globalPolicyExpanded)
    : providerProfileFiltered;
  const globalProviderFiltered = globalProviderExpanded
    ? filterToolsByPolicy(globalFiltered, globalProviderExpanded)
    : globalFiltered;
  const agentFiltered = agentPolicyExpanded
    ? filterToolsByPolicy(globalProviderFiltered, agentPolicyExpanded)
    : globalProviderFiltered;
  const agentProviderFiltered = agentProviderExpanded
    ? filterToolsByPolicy(agentFiltered, agentProviderExpanded)
    : agentFiltered;
  const groupFiltered = groupPolicyExpanded
    ? filterToolsByPolicy(agentProviderFiltered, groupPolicyExpanded)
    : agentProviderFiltered;
  const subagentFiltered = subagentPolicyExpanded
    ? filterToolsByPolicy(groupFiltered, subagentPolicyExpanded)
    : groupFiltered;

  const tool = subagentFiltered.find((t) => t.name === toolName);
  if (!tool) {
    sendJson(res, 404, {
      ok: false,
      error: { type: "not_found", message: `Tool not available: ${toolName}` },
    });
    return true;
  }

  const unsafeArgsError = getUnsafeArgsError(args);
  if (unsafeArgsError) {
    sendJson(res, 400, {
      ok: false,
      error: { type: "invalid_request_error", message: unsafeArgsError },
    });
    return true;
  }

  const toolArgs = mergeActionIntoArgsIfSupported({
    toolSchema: (tool as any).parameters,
    action,
    args,
  });

  try {
    const result = await (tool as any).execute?.(`http-${Date.now()}`, toolArgs);
    sendJson(res, 200, { ok: true, result });
  } catch (err) {
    logWarn(`gateway: tool invoke failed (${toolName}): ${String(err)}`);
    sendJson(res, 400, {
      ok: false,
      error: { type: "tool_error", message: "Tool execution failed" },
    });
  }

  return true;
}
