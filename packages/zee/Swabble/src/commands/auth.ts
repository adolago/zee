import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  resolveAuthProfileDisplayLabel,
  resolveAuthProfileOrder,
  resolveAuthStorePathForDisplay,
  setAuthProfileOrder,
} from "../agents/auth-profiles.js";
import { resolveAgentDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { normalizeProviderId } from "../agents/model-selection.js";
import { loadConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { RuntimeEnv } from "../runtime.js";
import { shortenHomePath } from "../utils.js";

type AuthStatusOptions = {
  provider?: string;
  agent?: string;
  json?: boolean;
};

type AuthUseOptions = {
  provider?: string;
  profile?: string;
  agent?: string;
  json?: boolean;
};

type AuthRotateOptions = {
  provider?: string;
  agent?: string;
  json?: boolean;
};

function resolveAgentContext(rawAgent?: string) {
  const cfg = loadConfig();
  const agentId = rawAgent?.trim()
    ? normalizeAgentId(rawAgent.trim())
    : resolveDefaultAgentId(cfg);
  const agentDir = resolveAgentDir(cfg, agentId);
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  return { cfg, agentId, agentDir, store };
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function resolveProvidersForStatus(params: {
  cfg: ReturnType<typeof loadConfig>;
  store: ReturnType<typeof ensureAuthProfileStore>;
  filterProvider?: string;
}): string[] {
  if (params.filterProvider) {
    return [normalizeProviderId(params.filterProvider)];
  }
  const fromStore = Object.values(params.store.profiles).map((cred) =>
    normalizeProviderId(cred.provider),
  );
  const fromConfigProfiles = Object.values(params.cfg.auth?.profiles ?? {}).map((profile) =>
    normalizeProviderId(profile.provider),
  );
  const fromConfigOrder = Object.keys(params.cfg.auth?.order ?? {}).map((provider) =>
    normalizeProviderId(provider),
  );
  const merged = uniqueOrdered([...fromConfigProfiles, ...fromStore, ...fromConfigOrder]);
  const priority = new Map(
    ["anthropic", "openai"].map((provider, index) => [provider, index] as const),
  );
  return merged.sort((a, b) => {
    const pa = priority.get(a);
    const pb = priority.get(b);
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
    return a.localeCompare(b);
  });
}

function resolveProfileHealth(params: {
  profile: {
    type: "api_key" | "oauth" | "token";
    expires?: number;
  };
  usage?: {
    cooldownUntil?: number;
    disabledUntil?: number;
    disabledReason?: string;
  };
}): { status: string; expiresInMs: number | null } {
  const now = Date.now();
  if (params.profile.type === "token") {
    const expires = params.profile.expires;
    if (typeof expires === "number" && Number.isFinite(expires) && expires > 0) {
      if (now >= expires) {
        return { status: "expired", expiresInMs: 0 };
      }
      return { status: "ready", expiresInMs: expires - now };
    }
  }

  const disabledUntil = params.usage?.disabledUntil;
  if (
    typeof disabledUntil === "number" &&
    Number.isFinite(disabledUntil) &&
    disabledUntil > now
  ) {
    const reason = params.usage?.disabledReason ? `:${params.usage.disabledReason}` : "";
    return { status: `disabled${reason}`, expiresInMs: disabledUntil - now };
  }

  const cooldownUntil = params.usage?.cooldownUntil;
  if (
    typeof cooldownUntil === "number" &&
    Number.isFinite(cooldownUntil) &&
    cooldownUntil > now
  ) {
    return { status: "cooldown", expiresInMs: cooldownUntil - now };
  }

  return { status: "ready", expiresInMs: null };
}

function formatDurationShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h`;
  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d`;
}

export async function authStatusCommand(opts: AuthStatusOptions, runtime: RuntimeEnv) {
  const { cfg, agentId, agentDir, store } = resolveAgentContext(opts.agent);
  const providers = resolveProvidersForStatus({
    cfg,
    store,
    filterProvider: opts.provider,
  });
  const authStorePath = resolveAuthStorePathForDisplay(agentDir);

  const items = providers.map((provider) => {
    const order = resolveAuthProfileOrder({ cfg, store, provider });
    const profileIds = listProfilesForProvider(store, provider);
    const profileItems = uniqueOrdered([...profileIds, ...order]).map((profileId) => {
      const profile = store.profiles[profileId];
      if (!profile) return { profileId, kind: "missing", status: "missing", label: profileId };
      const usage = store.usageStats?.[profileId];
      const health = resolveProfileHealth({ profile, usage });
      return {
        profileId,
        kind: profile.type,
        status: health.status,
        label: resolveAuthProfileDisplayLabel({ cfg, store, profileId }),
        expiresIn: health.expiresInMs,
      };
    });

    return {
      provider,
      activeProfile: order[0] ?? null,
      fallbackOrder: order,
      profiles: profileItems,
    };
  });

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          agentId,
          agentDir: shortenHomePath(agentDir),
          authStorePath: shortenHomePath(authStorePath),
          providers: items,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Agent: ${agentId}`);
  runtime.log(`Auth store: ${shortenHomePath(authStorePath)}`);
  if (items.length === 0) {
    runtime.log("No auth providers configured.");
    runtime.log("Use: zee auth login --provider anthropic");
    return;
  }

  for (const entry of items) {
    runtime.log("");
    runtime.log(`${entry.provider}:`);
    runtime.log(`  active: ${entry.activeProfile ?? "(none)"}`);
    runtime.log(
      `  fallback: ${
        entry.fallbackOrder.length > 0 ? entry.fallbackOrder.join(" -> ") : "(none)"
      }`,
    );
    if (entry.profiles.length === 0) {
      runtime.log("  profiles: (none)");
      continue;
    }
    runtime.log("  profiles:");
    for (const profile of entry.profiles) {
      const expiresSuffix =
        typeof profile.expiresIn === "number" && profile.expiresIn > 0
          ? ` (${formatDurationShort(profile.expiresIn)} remaining)`
          : "";
      runtime.log(
        `    - ${profile.profileId} [${profile.kind}] ${profile.status}${expiresSuffix}`,
      );
    }
  }
}

export async function authUseCommand(opts: AuthUseOptions, runtime: RuntimeEnv) {
  const providerRaw = opts.provider?.trim();
  if (!providerRaw) throw new Error("Missing --provider.");
  const profileId = opts.profile?.trim();
  if (!profileId) throw new Error("Missing --profile.");
  const provider = normalizeProviderId(providerRaw);

  const { cfg, agentId, agentDir, store } = resolveAgentContext(opts.agent);
  const profile = store.profiles[profileId];
  if (!profile) throw new Error(`Profile not found: ${profileId}`);
  if (normalizeProviderId(profile.provider) !== provider) {
    throw new Error(
      `Profile ${profileId} belongs to ${normalizeProviderId(profile.provider)}, not ${provider}.`,
    );
  }

  const currentOrder = resolveAuthProfileOrder({ cfg, store, provider });
  const knownProfiles = listProfilesForProvider(store, provider);
  const baseOrder = uniqueOrdered([...currentOrder, ...knownProfiles, profileId]);
  const nextOrder = uniqueOrdered([profileId, ...baseOrder]);

  const updated = await setAuthProfileOrder({
    agentDir,
    provider,
    order: nextOrder,
  });
  if (!updated) throw new Error("Failed to update auth profile order.");

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          agentId,
          provider,
          activeProfile: profileId,
          fallbackOrder: nextOrder,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Agent: ${agentId}`);
  runtime.log(`Provider: ${provider}`);
  runtime.log(`Active profile: ${profileId}`);
  runtime.log(`Fallback order: ${nextOrder.join(" -> ")}`);
}

export async function authRotateCommand(opts: AuthRotateOptions, runtime: RuntimeEnv) {
  const providerRaw = opts.provider?.trim();
  if (!providerRaw) throw new Error("Missing --provider.");
  const provider = normalizeProviderId(providerRaw);

  const { cfg, agentId, agentDir, store } = resolveAgentContext(opts.agent);
  const currentOrder = resolveAuthProfileOrder({ cfg, store, provider });
  if (currentOrder.length < 2) {
    throw new Error(`Need at least 2 profiles to rotate (provider: ${provider}).`);
  }

  const nextOrder = [...currentOrder.slice(1), currentOrder[0]];
  const updated = await setAuthProfileOrder({
    agentDir,
    provider,
    order: nextOrder,
  });
  if (!updated) throw new Error("Failed to update auth profile order.");

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          agentId,
          provider,
          previousActiveProfile: currentOrder[0],
          activeProfile: nextOrder[0],
          fallbackOrder: nextOrder,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Agent: ${agentId}`);
  runtime.log(`Provider: ${provider}`);
  runtime.log(`Active profile: ${currentOrder[0]} -> ${nextOrder[0]}`);
  runtime.log(`Fallback order: ${nextOrder.join(" -> ")}`);
}
