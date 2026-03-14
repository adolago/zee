/**
 * Embedding provider tests
 *
 * Tests dimension handling and provider creation for the unified memory layer.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createEmbeddingProvider,
  GoogleEmbeddingProvider,
} from "./embedding";
import { EMBEDDING_PROFILES, resolveEmbeddingProfile } from "../config/embedding-profiles";

function writeAuthStoreGoogleKey(params: { xdgDataHome: string; apiKey: string }) {
  const dir = path.join(params.xdgDataHome, "zee");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "auth.json"),
    JSON.stringify({ google: { type: "api", key: params.apiKey } }, null, 2),
    "utf-8",
  );
}

describe("embedding profiles", () => {
  it("defines google/gemini-embedding-2-preview with 3072 dimensions", () => {
    const profile = EMBEDDING_PROFILES["google/gemini-embedding-2-preview"];
    expect(profile).toBeDefined();
    expect(profile.provider).toBe("google");
    expect(profile.model).toBe("gemini-embedding-2-preview");
    expect(profile.dimensions).toBe(3072);
  });

  it("resolves google preview profile correctly", () => {
    const profile = resolveEmbeddingProfile("google/gemini-embedding-2-preview");
    expect(profile).toBeDefined();
    expect(profile?.provider).toBe("google");
    expect(profile?.model).toBe("gemini-embedding-2-preview");
    expect(profile?.dimensions).toBe(3072);
  });
});

describe("GoogleEmbeddingProvider", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;
  let xdgDataHome: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    xdgDataHome = fs.mkdtempSync(path.join(os.tmpdir(), "zee-test-xdg-data-"));
    process.env.XDG_DATA_HOME = xdgDataHome;
    process.env.XDG_STATE_HOME = xdgDataHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    try {
      fs.rmSync(xdgDataHome, { recursive: true, force: true });
    } catch {}
  });

  it("defaults to 3072 dimensions for gemini-embedding-2-preview", () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    const provider = new GoogleEmbeddingProvider({});
    expect(provider.dimension).toBe(3072);
    expect(provider.model).toBe("gemini-embedding-2-preview");
    expect(provider.id).toBe("google");
    expect(provider.supportsMultimodal).toBe(true);
    expect(provider.supportedMediaTypes).toEqual(["text", "image", "video", "audio", "pdf"]);
  });

  it("rejects non-3072 dimensions", () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    expect(() => new GoogleEmbeddingProvider({ dimensions: 768 })).toThrow(/always uses 3072/);
  });

  it("rejects non-preview embedding models", () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    expect(() => new GoogleEmbeddingProvider({ model: "gemini-embedding-001" })).toThrow(
      /always uses "gemini-embedding-2-preview"/,
    );
  });

  it("sends taskType and title for text embedding requests", async () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [{ values: [0.1, 0.2, 0.3] }] }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GoogleEmbeddingProvider({
      taskType: "RETRIEVAL_DOCUMENT",
      title: "Notebook",
    });
    const result = await provider.embed("hello world");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("models/gemini-embedding-2-preview:batchEmbedContents");
    expect(JSON.parse(String(init.body))).toEqual({
      requests: [
        {
          model: "models/gemini-embedding-2-preview",
          outputDimensionality: 3072,
          content: {
            role: "user",
            parts: [{ text: "hello world" }],
          },
          taskType: "RETRIEVAL_DOCUMENT",
          title: "Notebook",
        },
      ],
    });
  });

  it("encodes multimodal parts for gemini-embedding-2-preview", async () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [{ values: [1, 2, 3] }] }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GoogleEmbeddingProvider({});
    const result = await provider.embedMultimodal?.({
      contents: [
        { type: "text", content: "Describe this packet" },
        { type: "image", base64: "Zm9v", mimeType: "image/png" },
        { type: "pdf", url: "https://example.com/spec.pdf" },
      ],
    });

    expect(result).toEqual([1, 2, 3]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      requests: [
        {
          model: "models/gemini-embedding-2-preview",
          outputDimensionality: 3072,
          content: {
            role: "user",
            parts: [
              { text: "Describe this packet" },
              { inlineData: { mimeType: "image/png", data: "Zm9v" } },
              { fileData: { mimeType: "application/pdf", fileUri: "https://example.com/spec.pdf" } },
            ],
          },
        },
      ],
    });
  });

  it("throws without API key", () => {
    expect(() => new GoogleEmbeddingProvider({})).toThrow(/Google API key required/);
  });

  it("ignores env vars for API key", () => {
    process.env.GOOGLE_API_KEY = "env-key";
    process.env.GEMINI_API_KEY = "env-key";
    expect(() => new GoogleEmbeddingProvider({})).toThrow(/Google API key required/);
  });
});

describe("createEmbeddingProvider factory", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;
  let xdgDataHome: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    xdgDataHome = fs.mkdtempSync(path.join(os.tmpdir(), "zee-test-xdg-data-"));
    process.env.XDG_DATA_HOME = xdgDataHome;
    process.env.XDG_STATE_HOME = xdgDataHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    try {
      fs.rmSync(xdgDataHome, { recursive: true, force: true });
    } catch {}
  });

  it("creates google provider with correct defaults", () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    const provider = createEmbeddingProvider({ provider: "google" });
    expect(provider.id).toBe("google");
    expect(provider.dimension).toBe(3072);
    expect(provider.model).toBe("gemini-embedding-2-preview");
  });

  it("rejects custom dimensions config", () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    expect(() => createEmbeddingProvider({ provider: "google", dimensions: 768 })).toThrow(
      /always uses 3072/,
    );
  });
});
