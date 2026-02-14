import { describe, expect, it } from "vitest";

import { SYNTHETIC_MODEL_CATALOG, buildSyntheticModelDefinition } from "./synthetic-models.js";

describe("synthetic model catalog", () => {
  it("includes GLM-5 with reasoning and vision support", () => {
    const glm5 = SYNTHETIC_MODEL_CATALOG.find((entry) => entry.id === "hf:zai-org/GLM-5");
    expect(glm5).toBeTruthy();
    expect(glm5).toMatchObject({
      name: "GLM-5",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 256000,
      maxTokens: 128000,
    });
  });

  it("builds a usable model definition for GLM-5", () => {
    const glm5 = SYNTHETIC_MODEL_CATALOG.find((entry) => entry.id === "hf:zai-org/GLM-5");
    expect(glm5).toBeTruthy();
    const built = buildSyntheticModelDefinition(glm5!);
    expect(built).toMatchObject({
      id: "hf:zai-org/GLM-5",
      name: "GLM-5",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 256000,
      maxTokens: 128000,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
    });
  });
});
