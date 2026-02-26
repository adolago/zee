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

describe("P05 config migration parity harness", () => {
  // P05-CFG-001: migration guidance from .opencode to .zee without silent misconfiguration.
  test("P05-CFG-001 emits explicit remediation guidance and skips unsupported keys", async () => {
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
      "legacyPluginSetting": true
    }
  },
  "models": {
    "url": "https://models.dev/api.json",
    "experimentalModelRouting": true
  },
  "server": {
    "mdns": true,
    "legacyControlUi": true
  },
  "workspace": {
    "mode": "legacy"
  }
}
`,
        )
      },
    })

    const result = await importOpencodeConfig({ cwd: tmp.path })
    const categories = Object.fromEntries(result.unknown.categories.map((entry) => [entry.category, entry]))

    expect(result.mapped).toEqual(
      expect.arrayContaining(["provider.openai -> auth.openai", "models.url -> models.url", "server.mdns -> server.mdns"]),
    )
    expect(result.skipped).toEqual(expect.arrayContaining(["workspace: unsupported top-level key"]))

    expect(categories.topLevel?.keys).toEqual(expect.arrayContaining(["workspace"]))
    expect(categories.models?.keys).toEqual(expect.arrayContaining(["models.experimentalModelRouting"]))
    expect(categories.server?.keys).toEqual(expect.arrayContaining(["server.legacyControlUi"]))
    expect(categories.provider?.keys).toEqual(expect.arrayContaining(["provider.openai.legacyPluginSetting"]))

    expect(categories.topLevel?.hint).toContain("Move compatible values into .zee/zee.jsonc manually")
    expect(categories.provider?.hint).toContain("manual review")
    expect(categories.models?.hint).toContain("imported")
    expect(categories.server?.hint).toContain("imported")

    const targetConfigPath = path.join(tmp.path, ".zee", "zee.jsonc")
    const targetText = await Bun.file(targetConfigPath).text()
    const targetConfig = JSON.parse(targetText)

    expect(targetConfig.models?.url).toBe("https://models.dev/api.json")
    expect(targetConfig.server?.mdns).toBe(true)

    expect(targetConfig.workspace).toBeUndefined()
    expect(targetConfig.models?.experimentalModelRouting).toBeUndefined()
    expect(targetConfig.server?.legacyControlUi).toBeUndefined()

    const auth = await Auth.all()
    expect(auth.openai).toEqual({ type: "api", key: "openai-key" })
  })
})
