import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import type { ZeeConfig } from "../config/config.js";

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  return withTempHomeBase(fn, { prefix: "zee-models-" });
}

const MODELS_CONFIG: ZeeConfig = {
  models: {
    providers: {
      "custom-proxy": {
        baseUrl: "http://localhost:4000/v1",
        apiKey: "TEST_KEY",
        api: "openai-completions",
        models: [
          {
            id: "llama-3.1-8b",
            name: "Llama 3.1 8B (Proxy)",
            api: "openai-completions",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 32000,
          },
        ],
      },
    },
  },
};

describe("models-config", () => {
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
  });

  afterEach(() => {
    process.env.HOME = previousHome;
  });

  it("skips writing models.json when no env token or profile exists", async () => {
    await withTempHome(async (home) => {
      const cleared = new Map<string, string | undefined>();
      const keys = new Set<string>([
        ...Object.keys(process.env).filter((key) => key.endsWith("_API_KEY")),
        "COPILOT_GITHUB_TOKEN",
        "GH_TOKEN",
        "GITHUB_TOKEN",
      ]);
      for (const key of keys) {
        cleared.set(key, process.env[key]);
        delete process.env[key];
      }

      try {
        vi.resetModules();
        const { ensureZeeModelsJson } = await import("./models-config.js");

        const agentDir = path.join(home, "agent-empty");
        const result = await ensureZeeModelsJson(
          {
            models: { providers: {} },
          },
          agentDir,
        );

        await expect(fs.stat(path.join(agentDir, "models.json"))).rejects.toThrow();
        expect(result.wrote).toBe(false);
      } finally {
        for (const [key, value] of cleared) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
  });
  it("writes models.json for configured providers", async () => {
    await withTempHome(async () => {
      vi.resetModules();
      const { ensureZeeModelsJson } = await import("./models-config.js");
      const { resolveZeeAgentDir } = await import("./agent-paths.js");

      await ensureZeeModelsJson(MODELS_CONFIG);

      const modelPath = path.join(resolveZeeAgentDir(), "models.json");
      const raw = await fs.readFile(modelPath, "utf8");
      const parsed = JSON.parse(raw) as {
        providers: Record<string, { baseUrl?: string }>;
      };

      expect(parsed.providers["custom-proxy"]?.baseUrl).toBe("http://localhost:4000/v1");
    });
  });
  it("adds minimax provider when MINIMAX_API_KEY is set", async () => {
    await withTempHome(async () => {
      vi.resetModules();
      const prevKey = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = "sk-minimax-test";
      try {
        const { ensureZeeModelsJson } = await import("./models-config.js");
        const { resolveZeeAgentDir } = await import("./agent-paths.js");

        await ensureZeeModelsJson({});

        const modelPath = path.join(resolveZeeAgentDir(), "models.json");
        const raw = await fs.readFile(modelPath, "utf8");
        const parsed = JSON.parse(raw) as {
          providers: Record<
            string,
            {
              baseUrl?: string;
              apiKey?: string;
              models?: Array<{ id: string }>;
            }
          >;
        };
        expect(parsed.providers.minimax?.baseUrl).toBe("https://api.minimax.chat/v1");
        expect(parsed.providers.minimax?.apiKey).toBe("MINIMAX_API_KEY");
        const ids = parsed.providers.minimax?.models?.map((model) => model.id);
        expect(ids).toContain("MiniMax-M2.1");
        expect(ids).toContain("MiniMax-VL-01");
      } finally {
        if (prevKey === undefined) delete process.env.MINIMAX_API_KEY;
        else process.env.MINIMAX_API_KEY = prevKey;
      }
    });
  });
  it("adds synthetic provider when SYNTHETIC_API_KEY is set", async () => {
    await withTempHome(async () => {
      vi.resetModules();
      const prevKey = process.env.SYNTHETIC_API_KEY;
      process.env.SYNTHETIC_API_KEY = "sk-synthetic-test";
      try {
        const { ensureZeeModelsJson } = await import("./models-config.js");
        const { resolveZeeAgentDir } = await import("./agent-paths.js");

        await ensureZeeModelsJson({});

        const modelPath = path.join(resolveZeeAgentDir(), "models.json");
        const raw = await fs.readFile(modelPath, "utf8");
        const parsed = JSON.parse(raw) as {
          providers: Record<
            string,
            {
              baseUrl?: string;
              apiKey?: string;
              models?: Array<{ id: string }>;
            }
          >;
        };
        expect(parsed.providers.synthetic?.baseUrl).toBe("https://api.synthetic.new/anthropic");
        expect(parsed.providers.synthetic?.apiKey).toBe("SYNTHETIC_API_KEY");
        const ids = parsed.providers.synthetic?.models?.map((model) => model.id);
        expect(ids).toContain("hf:MiniMaxAI/MiniMax-M2.1");
      } finally {
        if (prevKey === undefined) delete process.env.SYNTHETIC_API_KEY;
        else process.env.SYNTHETIC_API_KEY = prevKey;
      }
    });
  });
});
