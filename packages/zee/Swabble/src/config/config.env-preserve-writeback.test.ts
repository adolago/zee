import fs from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { ZeeConfig } from "./types.js";
import { withEnvOverride, withTempHome } from "./test-helpers.js";

const CONFIG_WITH_ENV_REF = `{
  models: {
    providers: {
      anthropic: {
        baseUrl: "https://api.anthropic.com/v1",
        api: "anthropic-messages",
        apiKey: "\${ANTHROPIC_API_KEY}",
        models: []
      }
    }
  }
}
`;

describe("config writeback env reference preservation", () => {
  it("keeps ${VAR} reference when caller writes back unchanged resolved value", async () => {
    await withTempHome(async () => {
      await withEnvOverride({ ANTHROPIC_API_KEY: "sk-ant-secret" }, async () => {
        const { resolveConfigPath, loadConfig, writeConfigFile } = await import("./config.js");
        const configPath = resolveConfigPath();
        await fs.writeFile(configPath, CONFIG_WITH_ENV_REF, "utf-8");

        const loaded = loadConfig();
        await writeConfigFile(loaded);

        const persisted = await fs.readFile(configPath, "utf-8");
        expect(persisted).toContain('"${ANTHROPIC_API_KEY}"');
        expect(persisted).not.toContain("sk-ant-secret");
      });
    });
  });

  it("keeps explicit caller override instead of restoring old placeholder", async () => {
    await withTempHome(async () => {
      await withEnvOverride({ ANTHROPIC_API_KEY: "sk-ant-secret" }, async () => {
        const { resolveConfigPath, loadConfig, writeConfigFile } = await import("./config.js");
        const configPath = resolveConfigPath();
        await fs.writeFile(configPath, CONFIG_WITH_ENV_REF, "utf-8");

        const loaded = loadConfig() as ZeeConfig & {
          models?: {
            providers?: Record<string, { apiKey?: string }>;
          };
        };
        loaded.models ??= {};
        loaded.models.providers ??= {};
        loaded.models.providers.anthropic ??= {};
        loaded.models.providers.anthropic.apiKey = "manual-override";

        await writeConfigFile(loaded);

        const persisted = await fs.readFile(configPath, "utf-8");
        expect(persisted).toContain('"manual-override"');
        expect(persisted).not.toContain('"${ANTHROPIC_API_KEY}"');
      });
    });
  });
});
