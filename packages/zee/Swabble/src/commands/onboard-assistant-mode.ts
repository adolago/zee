import type { ZeeConfig } from "../config/config.js";

export function applyAssistantModePreset(cfg: ZeeConfig): ZeeConfig {
  return {
    ...cfg,
    session: {
      ...cfg.session,
      // Single-user default: keep DM continuity in the main session.
      dmScope: "main",
    },
    channels: {
      ...cfg.channels,
      defaults: {
        ...cfg.channels?.defaults,
        // Keep group activation explicit unless allowlisted.
        groupPolicy: "allowlist",
      },
    },
    tools: {
      ...cfg.tools,
      // Keep channel sends scoped unless explicitly allowed.
      message: {
        ...cfg.tools?.message,
        crossContext: {
          ...cfg.tools?.message?.crossContext,
          allowAcrossProviders: false,
        },
      },
    },
  };
}
