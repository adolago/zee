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
  LEGACY_LOCAL_EMBEDDINGGEMMA_MODEL,
  PREFERRED_LOCAL_EMBEDDINGGEMMA_QAT_MODEL,
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
  it("defines google/gemini-embedding-001 with 3072 dimensions", () => {
    const profile = EMBEDDING_PROFILES["google/gemini-embedding-001"];
    expect(profile).toBeDefined();
    expect(profile.provider).toBe("google");
    expect(profile.model).toBe("gemini-embedding-001");
    expect(profile.dimensions).toBe(3072);
  });

  it("resolves google profile correctly", () => {
    const profile = resolveEmbeddingProfile("google/gemini-embedding-001");
    expect(profile).toBeDefined();
    expect(profile?.provider).toBe("google");
    expect(profile?.dimensions).toBe(3072);
  });
});

describe("GoogleEmbeddingProvider", () => {
  const originalEnv = process.env;
  let xdgDataHome: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    xdgDataHome = fs.mkdtempSync(path.join(os.tmpdir(), "zee-test-xdg-data-"));
    process.env.XDG_DATA_HOME = xdgDataHome;
    process.env.XDG_STATE_HOME = xdgDataHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    try {
      fs.rmSync(xdgDataHome, { recursive: true, force: true });
    } catch {}
  });

  it("defaults to 3072 dimensions for gemini-embedding-001", () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    const provider = new GoogleEmbeddingProvider({});
    expect(provider.dimension).toBe(3072);
    expect(provider.model).toBe("gemini-embedding-001");
    expect(provider.id).toBe("google");
  });

  it("uses configured dimensions", () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    const provider = new GoogleEmbeddingProvider({ dimensions: 768 });
    expect(provider.dimension).toBe(768);
  });

  it("normalizes legacy embeddinggemma model to QAT variant", () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    const provider = new GoogleEmbeddingProvider({ model: LEGACY_LOCAL_EMBEDDINGGEMMA_MODEL });
    expect(provider.model).toBe(PREFERRED_LOCAL_EMBEDDINGGEMMA_QAT_MODEL);
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
  let xdgDataHome: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    xdgDataHome = fs.mkdtempSync(path.join(os.tmpdir(), "zee-test-xdg-data-"));
    process.env.XDG_DATA_HOME = xdgDataHome;
    process.env.XDG_STATE_HOME = xdgDataHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    try {
      fs.rmSync(xdgDataHome, { recursive: true, force: true });
    } catch {}
  });

  it("creates google provider with correct defaults", () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    const provider = createEmbeddingProvider({ provider: "google" });
    expect(provider.id).toBe("google");
    expect(provider.dimension).toBe(3072);
  });

  it("respects custom dimensions config", () => {
    writeAuthStoreGoogleKey({ xdgDataHome, apiKey: "test-key" });
    const provider = createEmbeddingProvider({ provider: "google", dimensions: 768 });
    expect(provider.dimension).toBe(768);
  });
});
