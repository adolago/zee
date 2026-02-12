import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GOOGLE_EMBEDDING_MODEL } from "./embeddings-gemini.js";

async function writeAuthStore(params: { xdgDataHome: string; apiKey: string }): Promise<void> {
  const authDir = path.join(params.xdgDataHome, "zee");
  await fs.mkdir(authDir, { recursive: true });
  await fs.writeFile(
    path.join(authDir, "auth.json"),
    JSON.stringify({ google: { type: "api", key: params.apiKey } }, null, 2),
    "utf-8",
  );
}

describe("memory embeddings (google-only)", () => {
  const original = {
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();

    if (original.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = original.XDG_DATA_HOME;

    if (original.XDG_STATE_HOME === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = original.XDG_STATE_HOME;

    if (original.GOOGLE_API_KEY === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = original.GOOGLE_API_KEY;

    if (original.GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = original.GEMINI_API_KEY;

    await Promise.all(tempDirs.splice(0).map(async (dir) => await fs.rm(dir, { recursive: true, force: true })));
  });

  it("reads api key from Zee auth store and does not allow headers to override it", async () => {
    const xdgDataHome = await fs.mkdtemp(path.join(os.tmpdir(), "zee-swabble-auth-"));
    tempDirs.push(xdgDataHome);
    process.env.XDG_DATA_HOME = xdgDataHome;
    await writeAuthStore({ xdgDataHome, apiKey: "auth-key" });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: [1, 2, 3] } }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");

    const cfg = {
      models: {
        providers: {
          google: {
            headers: {
              "x-goog-api-key": "provider-override",
              "X-Provider": "p",
            },
          },
        },
      },
    };

    const result = await createEmbeddingProvider({
      config: cfg as never,
      provider: "google",
      remote: {
        headers: {
          "x-goog-api-key": "remote-override",
          "X-Remote": "r",
        },
      },
      model: DEFAULT_GOOGLE_EMBEDDING_MODEL,
    });

    await result.provider.embedQuery("hello");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("auth-key");
    expect(headers["X-Provider"]).toBe("p");
    expect(headers["X-Remote"]).toBe("r");
  });

  it("ignores env vars when auth store is missing", async () => {
    const xdgDataHome = await fs.mkdtemp(path.join(os.tmpdir(), "zee-swabble-auth-missing-"));
    tempDirs.push(xdgDataHome);
    process.env.XDG_DATA_HOME = xdgDataHome;

    process.env.GOOGLE_API_KEY = "env-key";
    process.env.GEMINI_API_KEY = "env-key-2";

    const { createEmbeddingProvider } = await import("./embeddings.js");

    await expect(
      createEmbeddingProvider({
        config: {} as never,
        provider: "google",
        model: DEFAULT_GOOGLE_EMBEDDING_MODEL,
      }),
    ).rejects.toThrow(/zee auth login google/i);
  });
});

