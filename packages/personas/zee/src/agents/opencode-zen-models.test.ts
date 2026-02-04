import { describe, expect, it } from "vitest";

import {
  getAgentCoreZenStaticFallbackModels,
  OPENCODE_ZEN_MODEL_ALIASES,
  resolveAgentCoreZenAlias,
  resolveAgentCoreZenModelApi,
} from "./opencode-zen-models.js";

describe("resolveAgentCoreZenAlias", () => {
  it("resolves opus alias", () => {
    expect(resolveAgentCoreZenAlias("opus")).toBe("claude-opus-4-5");
  });

  it("keeps legacy aliases working", () => {
    expect(resolveAgentCoreZenAlias("sonnet")).toBe("claude-opus-4-5");
    expect(resolveAgentCoreZenAlias("haiku")).toBe("claude-opus-4-5");
    expect(resolveAgentCoreZenAlias("gpt4")).toBe("gpt-5.1");
    expect(resolveAgentCoreZenAlias("o1")).toBe("gpt-5.2");
    expect(resolveAgentCoreZenAlias("gemini-2.5")).toBe("gemini-3-pro");
  });

  it("resolves gpt5 alias", () => {
    expect(resolveAgentCoreZenAlias("gpt5")).toBe("gpt-5.2");
  });

  it("resolves gemini alias", () => {
    expect(resolveAgentCoreZenAlias("gemini")).toBe("gemini-3-pro");
  });

  it("returns input if no alias exists", () => {
    expect(resolveAgentCoreZenAlias("some-unknown-model")).toBe("some-unknown-model");
  });

  it("is case-insensitive", () => {
    expect(resolveAgentCoreZenAlias("OPUS")).toBe("claude-opus-4-5");
    expect(resolveAgentCoreZenAlias("Gpt5")).toBe("gpt-5.2");
  });
});

describe("resolveAgentCoreZenModelApi", () => {
  it("maps APIs by model family", () => {
    expect(resolveAgentCoreZenModelApi("claude-opus-4-5")).toBe("anthropic-messages");
    expect(resolveAgentCoreZenModelApi("gemini-3-pro")).toBe("google-generative-ai");
    expect(resolveAgentCoreZenModelApi("gpt-5.2")).toBe("openai-responses");
    expect(resolveAgentCoreZenModelApi("alpha-gd4")).toBe("openai-completions");
    expect(resolveAgentCoreZenModelApi("big-pickle")).toBe("openai-completions");
    expect(resolveAgentCoreZenModelApi("glm-4.7")).toBe("openai-completions");
    expect(resolveAgentCoreZenModelApi("some-unknown-model")).toBe("openai-completions");
  });
});

describe("getAgentCoreZenStaticFallbackModels", () => {
  it("returns an array of models", () => {
    const models = getAgentCoreZenStaticFallbackModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBe(11);
  });

  it("includes Claude, GPT, Gemini, and GLM models", () => {
    const models = getAgentCoreZenStaticFallbackModels();
    const ids = models.map((m) => m.id);

    expect(ids).toContain("claude-opus-4-5");
    expect(ids).toContain("gpt-5.2");
    expect(ids).toContain("gpt-5.1-codex");
    expect(ids).toContain("gemini-3-pro");
    expect(ids).toContain("glm-4.7");
    expect(ids).toContain("kimi-k2.5");
    expect(ids).toContain("kimi-k2.5-thinking");
  });

  it("returns valid ModelDefinitionConfig objects", () => {
    const models = getAgentCoreZenStaticFallbackModels();
    for (const model of models) {
      expect(model.id).toBeDefined();
      expect(model.name).toBeDefined();
      expect(typeof model.reasoning).toBe("boolean");
      expect(Array.isArray(model.input)).toBe(true);
      expect(model.cost).toBeDefined();
      expect(typeof model.contextWindow).toBe("number");
      expect(typeof model.maxTokens).toBe("number");
    }
  });
});

describe("OPENCODE_ZEN_MODEL_ALIASES", () => {
  it("has expected aliases", () => {
    expect(OPENCODE_ZEN_MODEL_ALIASES.opus).toBe("claude-opus-4-5");
    expect(OPENCODE_ZEN_MODEL_ALIASES.codex).toBe("gpt-5.1-codex");
    expect(OPENCODE_ZEN_MODEL_ALIASES.gpt5).toBe("gpt-5.2");
    expect(OPENCODE_ZEN_MODEL_ALIASES.gemini).toBe("gemini-3-pro");
    expect(OPENCODE_ZEN_MODEL_ALIASES.glm).toBe("glm-4.7");

    // Legacy aliases (kept for backward compatibility).
    expect(OPENCODE_ZEN_MODEL_ALIASES.sonnet).toBe("claude-opus-4-5");
    expect(OPENCODE_ZEN_MODEL_ALIASES.haiku).toBe("claude-opus-4-5");
    expect(OPENCODE_ZEN_MODEL_ALIASES.gpt4).toBe("gpt-5.1");
    expect(OPENCODE_ZEN_MODEL_ALIASES.o1).toBe("gpt-5.2");
    expect(OPENCODE_ZEN_MODEL_ALIASES["gemini-2.5"]).toBe("gemini-3-pro");
  });
});
