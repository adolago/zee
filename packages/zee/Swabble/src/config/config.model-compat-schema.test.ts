import { describe, expect, it } from "vitest";

import { validateConfigObject } from "./validation.js";

describe("model compat config schema", () => {
  it("accepts full openai-completions compat fields", () => {
    const res = validateConfigObject({
      models: {
        providers: {
          local: {
            baseUrl: "http://127.0.0.1:1234/v1",
            api: "openai-completions",
            models: [
              {
                id: "qwen3-32b",
                name: "Qwen3 32B",
                compat: {
                  supportsStore: true,
                  supportsDeveloperRole: true,
                  supportsReasoningEffort: true,
                  supportsUsageInStreaming: true,
                  supportsStrictMode: false,
                  maxTokensField: "max_completion_tokens",
                  thinkingFormat: "qwen",
                  requiresToolResultName: true,
                  requiresAssistantAfterToolResult: false,
                  requiresThinkingAsText: false,
                  requiresMistralToolIds: false,
                },
              },
            ],
          },
        },
      },
    });

    expect(res.ok).toBe(true);
  });

  it("rejects invalid enum values for full compat fields", () => {
    const res = validateConfigObject({
      models: {
        providers: {
          local: {
            baseUrl: "http://127.0.0.1:1234/v1",
            api: "openai-completions",
            models: [
              {
                id: "qwen3-32b",
                name: "Qwen3 32B",
                compat: {
                  maxTokensField: "bad",
                  thinkingFormat: "bad",
                },
              },
            ],
          },
        },
      },
    });

    expect(res.ok).toBe(false);
    expect(res.errors).toContain(
      "models.providers.local.models[0].compat.maxTokensField must be one of: max_completion_tokens, max_tokens",
    );
    expect(res.errors).toContain(
      "models.providers.local.models[0].compat.thinkingFormat must be one of: openai, zai, qwen",
    );
  });
});
