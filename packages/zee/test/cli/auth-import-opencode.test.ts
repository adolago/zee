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
      "options": {
        "apiKey": "openai-key",
        "baseURL": "https://api.openai.com/v1"
      }
    },
    "anthropic": {
      "apiKey": "anthropic-key"
    }
  },
  "auth": {
    "github": {
      "type": "api",
      "key": "ghp_key"
    }
  },
  "models": {
    "url": "https://models.dev/api.json",
    "path": "./models.json"
  },
  "server": {
    "mdns": true,
    "mdnsDomain": "opencode.local"
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
        "provider.anthropic -> auth.anthropic",
        "auth.github -> auth.github",
        "models.url -> models.url",
        "models.path -> models.path",
        "server.mdns -> server.mdns",
        "server.mdnsDomain -> server.mdnsDomain",
      ]),
    )
    expect(result.skipped).toEqual(expect.arrayContaining(["unknown_top_level: unsupported top-level key"]))

    const targetConfigPath = path.join(tmp.path, ".zee", "zee.jsonc")
    const targetText = await Bun.file(targetConfigPath).text()
    const targetConfig = JSON.parse(targetText)

    expect(targetConfig.$schema).toBe("zee")
    expect(targetConfig.models?.url).toBe("https://models.dev/api.json")
    expect(targetConfig.models?.path).toBe("./models.json")
    expect(targetConfig.server?.mdns).toBe(true)
    expect(targetConfig.server?.mdnsDomain).toBe("opencode.local")
    expect(targetConfig.provider?.openai?.options?.baseURL).toBe("https://api.openai.com/v1")

    const auth = await Auth.all()
    expect(auth.openai).toEqual({ type: "api", key: "openai-key" })
    expect(auth.anthropic).toEqual({ type: "api", key: "anthropic-key" })
    expect(auth.github).toEqual({ type: "api", key: "ghp_key" })
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
