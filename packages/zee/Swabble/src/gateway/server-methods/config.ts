import fs from "node:fs";

import JSON5 from "json5";

import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import {
  CONFIG_PATH,
  loadConfig,
  parseConfigJson5,
  readConfigFileSnapshot,
  resolveConfigSnapshotHash,
  validateConfigObjectWithPlugins,
  writeConfigFile,
  type ZeeConfig,
} from "../../config/config.js";
import { resolveConfigIncludes } from "../../config/includes.js";
import { applyLegacyMigrations } from "../../config/legacy.js";
import { applyMergePatch } from "../../config/merge-patch.js";
import { redactConfigObject, restoreRedactedValues } from "../../config/redact-snapshot.js";
import { buildConfigSchema } from "../../config/schema.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import { loadZeePlugins } from "../../plugins/loader.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateConfigApplyParams,
  validateConfigGetParams,
  validateConfigPatchParams,
  validateConfigSchemaParams,
  validateConfigSetParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function resolveBaseHash(params: unknown): string | null {
  const raw = (params as { baseHash?: unknown })?.baseHash;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function requireConfigBaseHash(
  params: unknown,
  snapshot: Awaited<ReturnType<typeof readConfigFileSnapshot>>,
  respond: RespondFn,
): boolean {
  if (!snapshot.exists) return true;
  const snapshotHash = resolveConfigSnapshotHash(snapshot);
  if (!snapshotHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config base hash unavailable; re-run config.get and retry",
      ),
    );
    return false;
  }
  const baseHash = resolveBaseHash(params);
  if (!baseHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config base hash required; re-run config.get and retry",
      ),
    );
    return false;
  }
  if (baseHash !== snapshotHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config changed since last load; re-run config.get and retry",
      ),
    );
    return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function resolveConfigWriteBase(
  snapshot: Awaited<ReturnType<typeof readConfigFileSnapshot>>,
): Record<string, unknown> {
  if (!snapshot.exists) return {};
  if (!isPlainObject(snapshot.parsed)) return {};

  let resolved: unknown = snapshot.parsed;
  try {
    resolved = resolveConfigIncludes(snapshot.parsed, snapshot.path, {
      readFile: (p) => fs.readFileSync(p, "utf-8"),
      parseJson: (raw) => JSON5.parse(raw),
    });
  } catch {
    resolved = snapshot.parsed;
  }

  const migrated = applyLegacyMigrations(resolved);
  const base = migrated.next ?? resolved;
  if (!isPlainObject(base)) return {};
  return base;
}

export const configHandlers: GatewayRequestHandlers = {
  "config.get": async ({ params, respond }) => {
    if (!validateConfigGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.get params: ${formatValidationErrors(validateConfigGetParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    const baseConfig = resolveConfigWriteBase(snapshot);
    const redactionPolicy = (baseConfig as ZeeConfig).security?.redaction;
    const redactedBase = redactConfigObject(baseConfig, redactionPolicy) as ZeeConfig;
    const raw = snapshot.exists ? JSON.stringify(redactedBase, null, 2).trimEnd().concat("\n") : null;
    respond(
      true,
      {
        ...snapshot,
        raw,
        parsed: redactedBase,
        config: redactedBase,
      },
      undefined,
    );
  },
  "config.schema": ({ params, respond }) => {
    if (!validateConfigSchemaParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.schema params: ${formatValidationErrors(validateConfigSchemaParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const pluginRegistry = loadZeePlugins({
      config: cfg,
      workspaceDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    });
    const schema = buildConfigSchema({
      plugins: pluginRegistry.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        configUiHints: plugin.configUiHints,
        configSchema: plugin.configJsonSchema,
      })),
      channels: listChannelPlugins().map((entry) => ({
        id: entry.id,
        label: entry.meta.label,
        description: entry.meta.blurb,
        configSchema: entry.configSchema?.schema,
        configUiHints: entry.configSchema?.uiHints,
      })),
    });
    respond(true, schema, undefined);
  },
  "config.set": async ({ params, respond }) => {
    if (!validateConfigSetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.set params: ${formatValidationErrors(validateConfigSetParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    const baseConfig = resolveConfigWriteBase(snapshot);
    const redactionPolicy = (baseConfig as ZeeConfig).security?.redaction;
    const rawValue = (params as { raw?: unknown }).raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config.set params: raw (string) required"),
      );
      return;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return;
    }
    const validated = validateConfigObjectWithPlugins(parsedRes.parsed);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    let restored: ZeeConfig;
    try {
      restored = restoreRedactedValues(validated.config, baseConfig, redactionPolicy);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, msg));
      return;
    }
    await writeConfigFile(restored);
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(restored, redactionPolicy),
      },
      undefined,
    );
  },
  "config.patch": async ({ params, respond }) => {
    if (!validateConfigPatchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.patch params: ${formatValidationErrors(validateConfigPatchParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config; fix before patching"),
      );
      return;
    }
    const baseConfig = resolveConfigWriteBase(snapshot);
    const redactionPolicy = (baseConfig as ZeeConfig).security?.redaction;
    const rawValue = (params as { raw?: unknown }).raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid config.patch params: raw (string) required",
        ),
      );
      return;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return;
    }
    if (
      !parsedRes.parsed ||
      typeof parsedRes.parsed !== "object" ||
      Array.isArray(parsedRes.parsed)
    ) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config.patch raw must be an object"),
      );
      return;
    }
    const merged = applyMergePatch(baseConfig, parsedRes.parsed);
    const migrated = applyLegacyMigrations(merged);
    const resolved = migrated.next ?? merged;
    let restored: unknown;
    try {
      restored = restoreRedactedValues(resolved, baseConfig, redactionPolicy);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, msg));
      return;
    }
    const validated = validateConfigObjectWithPlugins(restored);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    await writeConfigFile(validated.config);

    const sessionKey =
      typeof (params as { sessionKey?: unknown }).sessionKey === "string"
        ? (params as { sessionKey?: string }).sessionKey?.trim() || undefined
        : undefined;
    const note =
      typeof (params as { note?: unknown }).note === "string"
        ? (params as { note?: string }).note?.trim() || undefined
        : undefined;
    const restartDelayMsRaw = (params as { restartDelayMs?: unknown }).restartDelayMs;
    const restartDelayMs =
      typeof restartDelayMsRaw === "number" && Number.isFinite(restartDelayMsRaw)
        ? Math.max(0, Math.floor(restartDelayMsRaw))
        : undefined;

    const payload: RestartSentinelPayload = {
      kind: "config-apply",
      status: "ok",
      ts: Date.now(),
      sessionKey,
      message: note ?? null,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: "config.patch",
        root: CONFIG_PATH,
      },
    };
    let sentinelPath: string | null = null;
    try {
      sentinelPath = await writeRestartSentinel(payload);
    } catch {
      sentinelPath = null;
    }
    const restart = scheduleGatewaySigusr1Restart({
      delayMs: restartDelayMs,
      reason: "config.patch",
    });
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(validated.config, redactionPolicy),
        restart,
        sentinel: {
          path: sentinelPath,
          payload,
        },
      },
      undefined,
    );
  },
  "config.apply": async ({ params, respond }) => {
    if (!validateConfigApplyParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.apply params: ${formatValidationErrors(validateConfigApplyParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    const baseConfig = resolveConfigWriteBase(snapshot);
    const redactionPolicy = (baseConfig as ZeeConfig).security?.redaction;
    const rawValue = (params as { raw?: unknown }).raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid config.apply params: raw (string) required",
        ),
      );
      return;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return;
    }
    const validated = validateConfigObjectWithPlugins(parsedRes.parsed);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    let restored: ZeeConfig;
    try {
      restored = restoreRedactedValues(validated.config, baseConfig, redactionPolicy);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, msg));
      return;
    }
    await writeConfigFile(restored);

    const sessionKey =
      typeof (params as { sessionKey?: unknown }).sessionKey === "string"
        ? (params as { sessionKey?: string }).sessionKey?.trim() || undefined
        : undefined;
    const note =
      typeof (params as { note?: unknown }).note === "string"
        ? (params as { note?: string }).note?.trim() || undefined
        : undefined;
    const restartDelayMsRaw = (params as { restartDelayMs?: unknown }).restartDelayMs;
    const restartDelayMs =
      typeof restartDelayMsRaw === "number" && Number.isFinite(restartDelayMsRaw)
        ? Math.max(0, Math.floor(restartDelayMsRaw))
        : undefined;

    const payload: RestartSentinelPayload = {
      kind: "config-apply",
      status: "ok",
      ts: Date.now(),
      sessionKey,
      message: note ?? null,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: "config.apply",
        root: CONFIG_PATH,
      },
    };
    let sentinelPath: string | null = null;
    try {
      sentinelPath = await writeRestartSentinel(payload);
    } catch {
      sentinelPath = null;
    }
    const restart = scheduleGatewaySigusr1Restart({
      delayMs: restartDelayMs,
      reason: "config.apply",
    });
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(restored, redactionPolicy),
        restart,
        sentinel: {
          path: sentinelPath,
          payload,
        },
      },
      undefined,
    );
  },
};
