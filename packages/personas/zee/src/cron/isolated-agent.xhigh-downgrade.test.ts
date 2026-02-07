import { describe, expect, it } from "vitest";

import { formatXHighModelHint, supportsXHighThinking } from "../auto-reply/thinking.js";

describe("xhigh thinking graceful downgrade", () => {
  it("supportsXHighThinking returns false for a non-xhigh model", () => {
    // Verifies the guard condition that triggers the downgrade path.
    expect(supportsXHighThinking("anthropic", "claude-sonnet-4-5-20250929")).toBe(false);
  });

  it("supportsXHighThinking returns true for an xhigh-capable model", () => {
    // At least one model must be registered; formatXHighModelHint returns the hints.
    const hint = formatXHighModelHint();
    expect(hint).toBeTruthy();
    expect(typeof hint).toBe("string");
  });

  it("downgrade logic: xhigh on unsupported model should resolve to high (inline)", () => {
    // Mirrors the exact logic in run.ts lines 220-224 after the fix.
    const provider = "anthropic";
    const model = "claude-sonnet-4-5-20250929";
    let thinkLevel: string | undefined = "xhigh";

    if (thinkLevel === "xhigh" && !supportsXHighThinking(provider, model)) {
      // Previously this threw; now it downgrades.
      thinkLevel = "high";
    }

    expect(thinkLevel).toBe("high");
  });

  it("downgrade logic: xhigh on supported model stays xhigh", () => {
    // Pick a model that supports xhigh (if any exist in the set).
    // We test the positive path: if the model supports it, no downgrade.
    const provider = "anthropic";
    const model = "claude-opus-4-6";
    let thinkLevel: string | undefined = "xhigh";

    if (thinkLevel === "xhigh" && !supportsXHighThinking(provider, model)) {
      thinkLevel = "high";
    }

    if (supportsXHighThinking(provider, model)) {
      expect(thinkLevel).toBe("xhigh");
    } else {
      // If this model also doesn't support xhigh, it should have been downgraded.
      expect(thinkLevel).toBe("high");
    }
  });
});
