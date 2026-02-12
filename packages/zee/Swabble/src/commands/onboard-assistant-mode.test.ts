import { describe, expect, it } from "vitest";

import { applyAssistantModePreset } from "./onboard-assistant-mode.js";

describe("applyAssistantModePreset", () => {
  it("applies assistant-first defaults without dropping existing config", () => {
    const next = applyAssistantModePreset({
      gateway: { mode: "local" },
      session: { dmScope: "per-peer" },
      tools: {
        message: {
          crossContext: {
            allowWithinProvider: true,
            allowAcrossProviders: true,
          },
        },
      },
      channels: {
        defaults: {
          heartbeat: { showOk: true },
        },
      },
    });

    expect(next.gateway?.mode).toBe("local");
    expect(next.session?.dmScope).toBe("main");
    expect(next.channels?.defaults).toMatchObject({
      groupPolicy: "allowlist",
      heartbeat: { showOk: true },
    });
    expect(next.tools?.message?.crossContext).toMatchObject({
      allowWithinProvider: true,
      allowAcrossProviders: false,
    });
  });
});
