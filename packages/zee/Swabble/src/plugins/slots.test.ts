import { describe, expect, it } from "vitest";

import type { ZeeConfig } from "../config/config.js";
import { applyExclusiveSlotSelection } from "./slots.js";

describe("applyExclusiveSlotSelection", () => {
  it("selects the slot and disables other entries for the same kind", () => {
    const config: ZeeConfig = {
      plugins: {
        slots: { memory: "old-memory" },
        entries: {
          "old-memory": { enabled: true },
          memory: { enabled: true },
        },
      },
    };

    const result = applyExclusiveSlotSelection({
      config,
      selectedId: "memory",
      selectedKind: "memory",
      registry: {
        plugins: [
          { id: "old-memory", kind: "memory" },
          { id: "memory", kind: "memory" },
        ],
      },
    });

    expect(result.changed).toBe(true);
    expect(result.config.plugins?.slots?.memory).toBe("memory");
    expect(result.config.plugins?.entries?.["old-memory"]?.enabled).toBe(false);
    expect(result.warnings).toContain(
      'Exclusive slot "memory" switched from "old-memory" to "memory".',
    );
    expect(result.warnings).toContain('Disabled other "memory" slot plugins: old-memory.');
  });

  it("does nothing when the slot already matches", () => {
    const config: ZeeConfig = {
      plugins: {
        slots: { memory: "memory" },
        entries: {
          memory: { enabled: true },
        },
      },
    };

    const result = applyExclusiveSlotSelection({
      config,
      selectedId: "memory",
      selectedKind: "memory",
      registry: { plugins: [{ id: "memory", kind: "memory" }] },
    });

    expect(result.changed).toBe(false);
    expect(result.warnings).toHaveLength(0);
    expect(result.config).toBe(config);
  });

  it("warns when the slot falls back to a default", () => {
    const config: ZeeConfig = {
      plugins: {
        entries: {
          memory: { enabled: true },
        },
      },
    };

    const result = applyExclusiveSlotSelection({
      config,
      selectedId: "memory",
      selectedKind: "memory",
      registry: { plugins: [{ id: "memory", kind: "memory" }] },
    });

    expect(result.changed).toBe(true);
    expect(result.warnings).toContain(
      'Exclusive slot "memory" switched from "zee" to "memory".',
    );
  });

  it("skips changes when no exclusive slot applies", () => {
    const config: ZeeConfig = {};
    const result = applyExclusiveSlotSelection({
      config,
      selectedId: "custom",
    });

    expect(result.changed).toBe(false);
    expect(result.warnings).toHaveLength(0);
    expect(result.config).toBe(config);
  });
});
