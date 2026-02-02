import { OPENCODE_ZEN_DEFAULT_MODEL_REF } from "../agents/opencode-zen-models.js";
import type { ZeeConfig } from "../config/config.js";

export function applyAgentCoreZenProviderConfig(cfg: ZeeConfig): ZeeConfig {
  // Use the built-in opencode provider from pi-ai; only seed the allowlist alias.
  const models = { ...cfg.agents?.defaults?.models };
  models[OPENCODE_ZEN_DEFAULT_MODEL_REF] = {
    ...models[OPENCODE_ZEN_DEFAULT_MODEL_REF],
    alias: models[OPENCODE_ZEN_DEFAULT_MODEL_REF]?.alias ?? "Opus",
  };

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models,
      },
    },
  };
}

export function applyAgentCoreZenConfig(cfg: ZeeConfig): ZeeConfig {
  const next = applyAgentCoreZenProviderConfig(cfg);
  return {
    ...next,
    agents: {
      ...next.agents,
      defaults: {
        ...next.agents?.defaults,
        model: {
          ...(next.agents?.defaults?.model &&
          "fallbacks" in (next.agents.defaults.model as Record<string, unknown>)
            ? {
                fallbacks: (next.agents.defaults.model as { fallbacks?: string[] }).fallbacks,
              }
            : undefined),
          primary: OPENCODE_ZEN_DEFAULT_MODEL_REF,
        },
      },
    },
  };
}
