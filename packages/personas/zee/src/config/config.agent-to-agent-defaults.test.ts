import { describe, expect, it } from "vitest";
import { applyAgentToAgentDefaults } from "./defaults.js";
import type { ZeeConfig } from "./types.js";

describe("applyAgentToAgentDefaults", () => {
  it("adds allow list when enabled and missing", () => {
    const cfg = {
      agents: {
        list: [{ id: "zee" }, { id: "johny" }, { id: "stanley" }],
      },
      tools: {
        agentToAgent: { enabled: true },
      },
    } satisfies ZeeConfig;

    const next = applyAgentToAgentDefaults(cfg);

    expect(next.tools?.agentToAgent?.allow).toEqual(["zee", "johny", "stanley"]);
  });

  it("keeps existing allow list", () => {
    const cfg = {
      agents: {
        list: [{ id: "zee" }, { id: "johny" }],
      },
      tools: {
        agentToAgent: { enabled: true, allow: ["zee"] },
      },
    } satisfies ZeeConfig;

    const next = applyAgentToAgentDefaults(cfg);

    expect(next.tools?.agentToAgent?.allow).toEqual(["zee"]);
  });

  it("does nothing when disabled", () => {
    const cfg = {
      agents: {
        list: [{ id: "zee" }, { id: "johny" }],
      },
      tools: {
        agentToAgent: { enabled: false },
      },
    } satisfies ZeeConfig;

    const next = applyAgentToAgentDefaults(cfg);

    expect(next.tools?.agentToAgent?.allow).toBeUndefined();
  });

  it("defaults to main when no agents listed", () => {
    const cfg = {
      tools: {
        agentToAgent: { enabled: true },
      },
    } satisfies ZeeConfig;

    const next = applyAgentToAgentDefaults(cfg);

    expect(next.tools?.agentToAgent?.allow).toEqual(["main"]);
  });
});
