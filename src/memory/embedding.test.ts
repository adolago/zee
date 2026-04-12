/**
 * Embedding provider tests
 *
 * Zee memory embeddings are local-only.
 */

import { describe, expect, it } from "vitest";
import {
  createEmbeddingProvider,
  LocalEmbeddingProvider,
} from "./embedding";
import { EMBEDDING_PROFILES, resolveEmbeddingProfile } from "../config/embedding-profiles";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../config/constants";

describe("embedding profiles", () => {
  it("defines the local default profile", () => {
    const profile = EMBEDDING_PROFILES["local/zee-local-hash-embedding-v1"];
    expect(profile).toBeDefined();
    expect(profile.provider).toBe("local");
    expect(profile.model).toBe(EMBEDDING_MODEL);
    expect(profile.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it("resolves the local default profile", () => {
    const profile = resolveEmbeddingProfile("local/zee-local-hash-embedding-v1");
    expect(profile).toBeDefined();
    expect(profile?.provider).toBe("local");
    expect(profile?.model).toBe(EMBEDDING_MODEL);
    expect(profile?.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });
});

describe("LocalEmbeddingProvider", () => {
  it("creates deterministic normalized vectors without external credentials", async () => {
    const provider = new LocalEmbeddingProvider({});
    const first = await provider.embed("Alice prefers TypeScript and local memory.");
    const second = await provider.embed("Alice prefers TypeScript and local memory.");

    expect(provider.id).toBe("local");
    expect(provider.model).toBe(EMBEDDING_MODEL);
    expect(provider.dimension).toBe(EMBEDDING_DIMENSIONS);
    expect(first).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(second).toEqual(first);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 5);
  });

  it("supports custom local dimensions", async () => {
    const provider = new LocalEmbeddingProvider({ dimensions: 64 });
    const vector = await provider.embed("small local vector");

    expect(provider.dimension).toBe(64);
    expect(vector).toHaveLength(64);
  });

  it("converts multimodal references into local text tokens", async () => {
    const provider = new LocalEmbeddingProvider({});
    const vector = await provider.embedMultimodal({
      contents: [
        { type: "text", content: "Describe this packet" },
        { type: "image", base64: "Zm9v", mimeType: "image/png" },
        { type: "pdf", url: "https://example.com/spec.pdf" },
      ],
    });

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });
});

describe("createEmbeddingProvider factory", () => {
  it("always creates a local provider", () => {
    const provider = createEmbeddingProvider({});
    expect(provider.id).toBe("local");
    expect(provider.dimension).toBe(EMBEDDING_DIMENSIONS);
    expect(provider.model).toBe(EMBEDDING_MODEL);
  });

  it("ignores non-local provider hints", () => {
    const provider = createEmbeddingProvider({
      provider: "google" as "local",
      model: "remote-model",
      dimensions: 32,
    });

    expect(provider.id).toBe("local");
    expect(provider.dimension).toBe(32);
    expect(provider.model).toBe("remote-model");
  });
});
