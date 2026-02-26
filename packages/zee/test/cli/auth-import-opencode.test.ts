import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import { importOpencodeConfig } from "../../src/cli/cmd/auth-import-opencode"
import { tmpdir } from "../fixture/fixture"

async function clearAuthStore() {
  const all = await Auth.all()
  for (const providerID of Object.keys(all)) {
    await Auth.remove(providerID)
  }
}

afterEach(async () => {
  await clearAuthStore()
})

describe("zee auth import-opencode", () => {
  test("imports supported auth and config fields from .opencode/opencode.jsonc", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })
        await Bun.write(
          path.join(opencodeDir, "opencode.jsonc"),
          `{
  "provider": {
    "openai": {
      "whitelist": ["gpt-4o", "gpt-4.1"],
      "models": {
        "gpt-4o": {
          "name": "GPT-4o custom",
          "temperature": 0.2
        }
      },
      "options": {
        "apiKey": "openai-key",
        "baseURL": "https://api.openai.com/v1",
        "timeout": 120000,
        "setCacheKey": true,
        "enterpriseUrl": "https://github.example.com"
      }
    },
    "anthropic": {
      "apiKey": "anthropic-key",
      "blacklist": ["claude-legacy"]
    }
  },
  "auth": {
    "github": {
      "type": "api",
      "key": "ghp_key"
    }
  },
  "logLevel": "debug",
  "model": "openai/gpt-4o",
  "small_model": "openai/gpt-4o-mini",
  "disabled_providers": ["xai", "alibaba"],
  "share": "manual",
  "autoupdate": "notify",
  "username": "Artur",
  "models": {
    "url": "https://models.dev/api.json",
    "path": "./models.json"
  },
  "server": {
    "mdns": true,
    "mdnsDomain": "opencode.local",
    "port": 4444,
    "hostname": "127.0.0.1",
    "cors": ["https://example.com"]
  },
  "unknown_top_level": {
    "enabled": true
  }
}
`,
        )
      },
    })

    const result = await importOpencodeConfig({ cwd: tmp.path })

    expect(result.mapped).toEqual(
      expect.arrayContaining([
        "provider.openai -> auth.openai",
        "provider.openai.baseURL -> provider.openai.options.baseURL",
        "provider.openai.timeout -> provider.openai.options.timeout",
        "provider.openai.setCacheKey -> provider.openai.options.setCacheKey",
        "provider.openai.enterpriseUrl -> provider.openai.options.enterpriseUrl",
        "provider.openai.whitelist -> provider.openai.whitelist",
        "provider.openai.models -> provider.openai.models",
        "provider.anthropic -> auth.anthropic",
        "provider.anthropic.blacklist -> provider.anthropic.blacklist",
        "auth.github -> auth.github",
        "logLevel -> logLevel",
        "model -> model",
        "small_model -> small_model",
        "disabled_providers -> disabled_providers",
        "share -> share",
        "autoupdate -> autoupdate",
        "username -> username",
        "models.url -> models.url",
        "models.path -> models.path",
        "server.mdns -> server.mdns",
        "server.mdnsDomain -> server.mdnsDomain",
        "server.port -> server.port",
        "server.hostname -> server.hostname",
        "server.cors -> server.cors",
      ]),
    )
    expect(result.skipped).toEqual(expect.arrayContaining(["unknown_top_level: unsupported top-level key"]))
    expect(result.unknown.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "topLevel",
          keys: expect.arrayContaining(["unknown_top_level"]),
        }),
      ]),
    )

    const targetConfigPath = path.join(tmp.path, ".zee", "zee.jsonc")
    const targetText = await Bun.file(targetConfigPath).text()
    const targetConfig = JSON.parse(targetText)

    expect(targetConfig.$schema).toBe("zee")
    expect(targetConfig.models?.url).toBe("https://models.dev/api.json")
    expect(targetConfig.models?.path).toBe("./models.json")
    expect(targetConfig.server?.mdns).toBe(true)
    expect(targetConfig.server?.mdnsDomain).toBe("opencode.local")
    expect(targetConfig.server?.port).toBe(4444)
    expect(targetConfig.server?.hostname).toBe("127.0.0.1")
    expect(targetConfig.server?.cors).toEqual(["https://example.com"])
    expect(targetConfig.logLevel).toBe("debug")
    expect(targetConfig.model).toBe("openai/gpt-4o")
    expect(targetConfig.small_model).toBe("openai/gpt-4o-mini")
    expect(targetConfig.disabled_providers).toEqual(["xai", "alibaba"])
    expect(targetConfig.share).toBe("manual")
    expect(targetConfig.autoupdate).toBe("notify")
    expect(targetConfig.username).toBe("Artur")
    expect(targetConfig.provider?.openai?.options?.baseURL).toBe("https://api.openai.com/v1")
    expect(targetConfig.provider?.openai?.options?.timeout).toBe(120000)
    expect(targetConfig.provider?.openai?.options?.setCacheKey).toBe(true)
    expect(targetConfig.provider?.openai?.options?.enterpriseUrl).toBe("https://github.example.com")
    expect(targetConfig.provider?.openai?.whitelist).toEqual(["gpt-4o", "gpt-4.1"])
    expect(targetConfig.provider?.openai?.models?.["gpt-4o"]?.name).toBe("GPT-4o custom")
    expect(targetConfig.provider?.anthropic?.blacklist).toEqual(["claude-legacy"])

    const auth = await Auth.all()
    expect(auth.openai).toEqual({ type: "api", key: "openai-key" })
    expect(auth.anthropic).toEqual({ type: "api", key: "anthropic-key" })
    expect(auth.github).toEqual({ type: "api", key: "ghp_key" })
  })

  test("reports structured unknown-key diagnostics for unsupported nested keys", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })
        await Bun.write(
          path.join(opencodeDir, "opencode.jsonc"),
          `{
  "provider": {
    "openai": {
      "apiKey": "openai-key",
      "legacySetting": true,
      "options": {
        "baseURL": "https://api.openai.com/v1",
        "legacy_flag": true
      }
    }
  },
  "models": {
    "url": "https://models.dev/api.json",
    "extra": "legacy"
  },
  "server": {
    "mdns": true,
    "unrecognized": true
  },
  "unknown_top_level": true
}
`,
        )
      },
    })

    const result = await importOpencodeConfig({ cwd: tmp.path })
    const categories = Object.fromEntries(result.unknown.categories.map((category) => [category.category, category]))

    expect(result.skipped).toEqual(expect.arrayContaining(["unknown_top_level: unsupported top-level key"]))
    expect(categories.topLevel?.keys).toEqual(expect.arrayContaining(["unknown_top_level"]))
    expect(categories.provider?.keys).toEqual(
      expect.arrayContaining(["provider.openai.legacySetting", "provider.openai.options.legacy_flag"]),
    )
    expect(categories.models?.keys).toEqual(expect.arrayContaining(["models.extra"]))
    expect(categories.server?.keys).toEqual(expect.arrayContaining(["server.unrecognized"]))
    expect(categories.provider?.hint).toContain("manual review")
  })

  test("dry run reports mappings without writing files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })
        await Bun.write(
          path.join(opencodeDir, "opencode.jsonc"),
          `{
  "provider": {
    "openai": {
      "apiKey": "openai-key"
    }
  }
}
`,
        )
      },
    })

    const result = await importOpencodeConfig({ cwd: tmp.path, dryRun: true })
    expect(result.dryRun).toBe(true)
    expect(result.mapped).toEqual(expect.arrayContaining(["provider.openai -> auth.openai"]))

    const targetConfigPath = path.join(tmp.path, ".zee", "zee.jsonc")
    expect(await Bun.file(targetConfigPath).exists()).toBe(false)
    expect(await Auth.get("openai")).toBeUndefined()
  })

  test("throws actionable errors for invalid JSONC input", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })
        await Bun.write(path.join(opencodeDir, "opencode.jsonc"), `{"provider": { "openai": { "apiKey": "broken" }`)
      },
    })

    await expect(importOpencodeConfig({ cwd: tmp.path })).rejects.toThrow("Invalid OpenCode JSONC")
  })
})
