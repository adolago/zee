import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ZeeConfig } from "../../config/config.js";

vi.mock("../auth-profiles/zee-auth-sync.js", () => ({
  syncZeeAuthCredentials: () => false,
}));

vi.mock("../auth-profiles.js", async (importOriginal) => {
  const actual = await importOriginal();
  const fs = await import("node:fs");
  const path = await import("node:path");
  const emptyStore = { version: 1, profiles: {} } as const;
  return {
    ...actual,
    ensureAuthProfileStore: (agentDir?: string) => {
      if (!agentDir) return { ...emptyStore };
      const storePath = path.join(agentDir, "auth-profiles.json");
      if (!fs.existsSync(storePath)) return { ...emptyStore };
      try {
        const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
        if (parsed && typeof parsed === "object" && "profiles" in parsed) {
          return parsed;
        }
      } catch {
        // ignore parse errors
      }
      return { ...emptyStore };
    },
  };
});

let imageTool: typeof import("./image-tool.js");

beforeAll(async () => {
  imageTool = await import("./image-tool.js");
});

async function writeAuthProfiles(agentDir: string, profiles: unknown) {
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(
    path.join(agentDir, "auth-profiles.json"),
    `${JSON.stringify(profiles, null, 2)}\n`,
    "utf8",
  );
}

describe("image tool implicit imageModel config", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", "");
    vi.stubEnv("MINIMAX_API_KEY", "");
    // Avoid implicit Copilot provider discovery hitting the network in tests.
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "");
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // @ts-expect-error global fetch cleanup
    global.fetch = priorFetch;
  });

  it("stays disabled without auth when no pairing is possible", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-image-"));
    const cfg: ZeeConfig = {
      agents: { defaults: { model: { primary: "openai/gpt-5.2" } } },
    };
    expect(imageTool.resolveImageModelConfigForTool({ cfg, agentDir })).toBeNull();
    expect(imageTool.createImageTool({ config: cfg, agentDir })).toBeNull();
  });

  it("pairs minimax primary with MiniMax-VL-01 (and fallbacks) when auth exists", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-image-"));
    vi.stubEnv("MINIMAX_API_KEY", "minimax-test");
    vi.stubEnv("OPENAI_API_KEY", "openai-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test");
    const cfg: ZeeConfig = {
      agents: { defaults: { model: { primary: "minimax/MiniMax-M2.1" } } },
    };
    expect(imageTool.resolveImageModelConfigForTool({ cfg, agentDir })).toEqual({
      primary: "minimax/MiniMax-VL-01",
      fallbacks: ["openai/gpt-5-mini", "anthropic/claude-opus-4-5"],
    });
    expect(imageTool.createImageTool({ config: cfg, agentDir })).not.toBeNull();
  });

  it("pairs a custom provider when it declares an image-capable model", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-image-"));
    await writeAuthProfiles(agentDir, {
      version: 1,
      profiles: {
        "acme:default": { type: "api_key", provider: "acme", key: "sk-test" },
      },
    });
    const cfg: ZeeConfig = {
      agents: { defaults: { model: { primary: "acme/text-1" } } },
      models: {
        providers: {
          acme: {
            models: [
              { id: "text-1", input: ["text"] },
              { id: "vision-1", input: ["text", "image"] },
            ],
          },
        },
      },
    };
    expect(imageTool.resolveImageModelConfigForTool({ cfg, agentDir })).toEqual({
      primary: "acme/vision-1",
    });
    expect(imageTool.createImageTool({ config: cfg, agentDir })).not.toBeNull();
  });

  it("prefers explicit agents.defaults.imageModel", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-image-"));
    const cfg: ZeeConfig = {
      agents: {
        defaults: {
          model: { primary: "minimax/MiniMax-M2.1" },
          imageModel: { primary: "openai/gpt-5-mini" },
        },
      },
    };
    expect(imageTool.resolveImageModelConfigForTool({ cfg, agentDir })).toEqual({
      primary: "openai/gpt-5-mini",
    });
  });

  it("keeps image tool available when primary model supports images (for explicit requests)", async () => {
    // When the primary model supports images, we still keep the tool available
    // because images are auto-injected into prompts. The tool description is
    // adjusted via modelHasVision to discourage redundant usage.
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-image-"));
    const cfg: ZeeConfig = {
      agents: {
        defaults: {
          model: { primary: "acme/vision-1" },
          imageModel: { primary: "openai/gpt-5-mini" },
        },
      },
      models: {
        providers: {
          acme: {
            models: [{ id: "vision-1", input: ["text", "image"] }],
          },
        },
      },
    };
    // Tool should still be available for explicit image analysis requests
    expect(imageTool.resolveImageModelConfigForTool({ cfg, agentDir })).toEqual({
      primary: "openai/gpt-5-mini",
    });
    const tool = imageTool.createImageTool({ config: cfg, agentDir, modelHasVision: true });
    expect(tool).not.toBeNull();
    expect(tool?.description).toContain(
      "Only use this tool when the image was NOT already provided",
    );
  });

  it("sandboxes image paths like the read tool", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-image-sandbox-"));
    const agentDir = path.join(stateDir, "agent");
    const sandboxRoot = path.join(stateDir, "sandbox");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(sandboxRoot, { recursive: true });
    await fs.writeFile(path.join(sandboxRoot, "img.png"), "fake", "utf8");

    vi.stubEnv("OPENAI_API_KEY", "openai-test");
    const cfg: ZeeConfig = {
      agents: { defaults: { model: { primary: "minimax/MiniMax-M2.1" } } },
    };
    const tool = imageTool.createImageTool({ config: cfg, agentDir, sandboxRoot });
    expect(tool).not.toBeNull();
    if (!tool) throw new Error("expected image tool");

    await expect(tool.execute("t1", { image: "https://example.com/a.png" })).rejects.toThrow(
      /Sandboxed image tool does not allow remote URLs/i,
    );

    await expect(tool.execute("t2", { image: "../escape.png" })).rejects.toThrow(
      /escapes sandbox root/i,
    );
  });

  it("rewrites inbound absolute paths into sandbox media/inbound", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-image-sandbox-"));
    const agentDir = path.join(stateDir, "agent");
    const sandboxRoot = path.join(stateDir, "sandbox");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(path.join(sandboxRoot, "media", "inbound"), {
      recursive: true,
    });
    const pngB64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";
    await fs.writeFile(
      path.join(sandboxRoot, "media", "inbound", "photo.png"),
      Buffer.from(pngB64, "base64"),
    );

    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        content: "ok",
        base_resp: { status_code: 0, status_msg: "" },
      }),
    });
    // @ts-expect-error partial global
    global.fetch = fetch;
    vi.stubEnv("MINIMAX_API_KEY", "minimax-test");

    const cfg: ZeeConfig = {
      agents: {
        defaults: {
          model: { primary: "minimax/MiniMax-M2.1" },
          imageModel: { primary: "minimax/MiniMax-VL-01" },
        },
      },
    };
    const tool = imageTool.createImageTool({ config: cfg, agentDir, sandboxRoot });
    expect(tool).not.toBeNull();
    if (!tool) throw new Error("expected image tool");

    const res = await tool.execute("t1", {
      prompt: "Describe the image.",
      image: "@/Users/steipete/.zee/media/inbound/photo.png",
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((res.details as { rewrittenFrom?: string }).rewrittenFrom).toContain("photo.png");
  });
});

describe("image tool data URL support", () => {
  it("decodes base64 image data URLs", () => {
    const pngB64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";
    const out = imageTool.__testing.decodeDataUrl(`data:image/png;base64,${pngB64}`);
    expect(out.kind).toBe("image");
    expect(out.mimeType).toBe("image/png");
    expect(out.buffer.length).toBeGreaterThan(0);
  });

  it("rejects non-image data URLs", () => {
    expect(() => imageTool.__testing.decodeDataUrl("data:text/plain;base64,SGVsbG8=")).toThrow(
      /Unsupported data URL type/i,
    );
  });
});

describe("image tool MiniMax VLM routing", () => {
  const pngB64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";
  const priorFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("MINIMAX_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_OAUTH_TOKEN", "");
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "");
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // @ts-expect-error global fetch cleanup
    global.fetch = priorFetch;
  });

  it("calls /v1/coding_plan/vlm for minimax image models", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        content: "ok",
        base_resp: { status_code: 0, status_msg: "" },
      }),
    });
    // @ts-expect-error partial global
    global.fetch = fetch;

    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-minimax-vlm-"));
    vi.stubEnv("MINIMAX_API_KEY", "minimax-test");
    await writeAuthProfiles(agentDir, {
      version: 1,
      profiles: {
        "minimax:default": { type: "api_key", provider: "minimax", key: "minimax-test" },
      },
      order: { minimax: ["minimax:default"] },
    });
    const cfg: ZeeConfig = {
      agents: { defaults: { model: { primary: "minimax/MiniMax-M2.1" } } },
    };
    const tool = imageTool.createImageTool({ config: cfg, agentDir });
    expect(tool).not.toBeNull();
    if (!tool) throw new Error("expected image tool");

    const res = await tool.execute("t1", {
      prompt: "Describe the image.",
      image: `data:image/png;base64,${pngB64}`,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.minimax.chat/v1/coding_plan/vlm");
    expect(init?.method).toBe("POST");
    expect(String((init?.headers as Record<string, string>)?.Authorization)).toBe(
      "Bearer minimax-test",
    );
    expect(String(init?.body)).toContain('"prompt":"Describe the image."');
    expect(String(init?.body)).toContain('"image_url":"data:image/png;base64,');

    const text = res.content?.find((b) => b.type === "text")?.text ?? "";
    expect(text).toBe("ok");
  });

  it("surfaces MiniMax API errors from /v1/coding_plan/vlm", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        content: "",
        base_resp: { status_code: 1004, status_msg: "bad key" },
      }),
    });
    // @ts-expect-error partial global
    global.fetch = fetch;

    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zee-minimax-vlm-"));
    vi.stubEnv("MINIMAX_API_KEY", "minimax-test");
    await writeAuthProfiles(agentDir, {
      version: 1,
      profiles: {
        "minimax:default": { type: "api_key", provider: "minimax", key: "minimax-test" },
      },
      order: { minimax: ["minimax:default"] },
    });
    const cfg: ZeeConfig = {
      agents: { defaults: { model: { primary: "minimax/MiniMax-M2.1" } } },
    };
    const tool = imageTool.createImageTool({ config: cfg, agentDir });
    expect(tool).not.toBeNull();
    if (!tool) throw new Error("expected image tool");

    await expect(
      tool.execute("t1", {
        prompt: "Describe the image.",
        image: `data:image/png;base64,${pngB64}`,
      }),
    ).rejects.toThrow(/MiniMax VLM API error/i);
  });
});

describe("image tool response validation", () => {
  it("rejects image-model responses with no final text", () => {
    expect(() =>
      imageTool.__testing.coerceImageAssistantText({
        provider: "openai",
        model: "gpt-5-mini",
        message: {
          role: "assistant",
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          stopReason: "stop",
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          content: [{ type: "thinking", thinking: "hmm" }],
        },
      }),
    ).toThrow(/returned no text/i);
  });

  it("surfaces provider errors from image-model responses", () => {
    expect(() =>
      imageTool.__testing.coerceImageAssistantText({
        provider: "openai",
        model: "gpt-5-mini",
        message: {
          role: "assistant",
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          stopReason: "error",
          errorMessage: "boom",
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          content: [],
        },
      }),
    ).toThrow(/boom/i);
  });

  it("returns trimmed text from image-model responses", () => {
    const text = imageTool.__testing.coerceImageAssistantText({
      provider: "anthropic",
      model: "claude-opus-4-5",
      message: {
        role: "assistant",
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-opus-4-5",
        stopReason: "stop",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        content: [{ type: "text", text: "  hello  " }],
      },
    });
    expect(text).toBe("hello");
  });
});
