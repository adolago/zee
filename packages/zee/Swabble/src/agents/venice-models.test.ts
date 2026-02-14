import { describe, expect, it } from "vitest";

import {
  VENICE_MODEL_CATALOG,
  buildVeniceModelDefinition,
  discoverVeniceModels,
} from "./venice-models.js";

describe("venice model definitions", () => {
  it("marks static catalog models as not supporting usage in streaming", () => {
    const first = buildVeniceModelDefinition(VENICE_MODEL_CATALOG[0]);
    expect(first.compat?.supportsUsageInStreaming).toBe(false);
  });

  it("applies usage-in-streaming compat flag to discovered test-environment models", async () => {
    const discovered = await discoverVeniceModels();
    expect(discovered.length).toBeGreaterThan(0);
    for (const model of discovered) {
      expect(model.compat?.supportsUsageInStreaming).toBe(false);
    }
  });
});
