import { describe, expect, it } from "vitest";

import { restoreEnvVarRefs } from "./env-preserve.js";

describe("restoreEnvVarRefs", () => {
  it("restores full ${VAR} placeholders when value matches env-resolved value", () => {
    const next = { models: { providers: { anthropic: { apiKey: "sk-ant-secret" } } } };
    const original = { models: { providers: { anthropic: { apiKey: "${ANTHROPIC_API_KEY}" } } } };
    const restored = restoreEnvVarRefs(next, original, { ANTHROPIC_API_KEY: "sk-ant-secret" }) as {
      models: { providers: { anthropic: { apiKey: string } } };
    };

    expect(restored.models.providers.anthropic.apiKey).toBe("${ANTHROPIC_API_KEY}");
  });

  it("keeps changed values when caller intentionally modified them", () => {
    const next = { key: "override" };
    const original = { key: "${MY_KEY}" };
    const restored = restoreEnvVarRefs(next, original, { MY_KEY: "original" }) as { key: string };
    expect(restored.key).toBe("override");
  });

  it("only restores full-string references", () => {
    const next = { key: "prefix-secret-suffix" };
    const original = { key: "prefix-${MY_KEY}-suffix" };
    const restored = restoreEnvVarRefs(next, original, { MY_KEY: "secret" }) as { key: string };
    expect(restored.key).toBe("prefix-secret-suffix");
  });
});
