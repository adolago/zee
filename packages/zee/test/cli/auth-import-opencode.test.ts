import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { Auth } from "../../src/auth"
import { buildOpencodeImportPlan, importOpencodeConfig } from "../../src/cli/cmd/auth-import-opencode"
import { tmpdir } from "../fixture/fixture"

const TEST_PROVIDERS = ["oc-import-api", "oc-import-oauth", "oc-write-provider", "oc-write-oauth"]

afterEach(async () => {
  for (const providerID of TEST_PROVIDERS) {
    await Auth.remove(providerID).catch(() => {})
  }
})

describe("buildOpencodeImportPlan", () => {
  test("maps supported keys and buckets unknown keys by category", () => {
    const plan = buildOpencodeImportPlan({
      logLevel: "DEBUG",
      model: "openrouter/qwen/qwen3-coder-next",
      smallModel: "openrouter/qwen/qwen3-14b",
      disabledProviders: ["foo/bar"],
      share: "manual",
      autoupdate: "notify",
      username: "zee-user",
      theme: "solarized",
      models: {
        baseURL: "https://models.example.local",
        path: "./catalog.json",
        routing: "custom",
      },
      server: {
        port: 3220,
        hostname: "0.0.0.0",
        cors: ["https://example.com"],
        mdnsDomain: "zee.local",
        mdns: { enabled: true, minimal: true },
        legacy: true,
      },
      providers: {
        "oc-import-api": {
          apiKey: "sk-api",
          baseURL: "https://provider.example/v1",
          timeout: 120000,
          setCacheKey: true,
          enterpriseUrl: "https://enterprise.example",
          whitelist: ["provider/model-a"],
          blacklist: ["provider/model-b"],
          models: {
            "provider/model-a": {
              name: "Model A",
            },
          },
          strangeField: 42,
        },
        "oc-import-oauth": {
          oauth: {
            refresh: "refresh-token",
            access: "access-token",
            expires: 1_730_000_000,
            accountId: "acct-123",
          },
          odd: true,
        },
      },
    })

    expect(plan.mapped).toContain("logLevel")
    expect(plan.mapped).toContain("models.url")
    expect(plan.mapped).toContain("server.mdns")
    expect(plan.mapped).toContain("provider.oc-import-api.options.baseURL")
    expect(plan.mapped).toContain("auth.oc-import-api.api")
    expect(plan.mapped).toContain("auth.oc-import-oauth.oauth")
    expect(plan.authEntries["oc-import-oauth"]).toEqual({
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: 1_730_000_000_000,
      accountId: "acct-123",
    })

    expect(plan.unknown.topLevel).toContain("theme")
    expect(plan.unknown.models).toContain("models.routing")
    expect(plan.unknown.server).toContain("server.legacy")
    expect(plan.unknown.provider).toContain("providers.oc-import-api.strangeField")
    expect(plan.unknown.provider).toContain("providers.oc-import-oauth.odd")
  })
})

describe("importOpencodeConfig", () => {
  test("dry-run reports changes without writing config or auth", async () => {
    const sandbox = await tmpdir()
    try {
      const sourceDir = path.join(sandbox.path, ".opencode")
      await Bun.write(
        path.join(sourceDir, "opencode.jsonc"),
        `{
  "logLevel": "INFO",
  "providers": {
    "oc-import-api": {
      "apiKey": "dry-run-key",
      "baseURL": "https://api.example/v1"
    }
  }
}`,
      )

      const report = await importOpencodeConfig({
        cwd: sandbox.path,
        dryRun: true,
      })

      expect(report.dryRun).toBe(true)
      expect(report.mapped).toContain("logLevel")
      expect(report.mapped).toContain("provider.oc-import-api.options.baseURL")
      expect(report.authProviders).toEqual(["oc-import-api"])

      const targetExists = await Bun.file(path.join(sandbox.path, ".zee", "zee.jsonc")).exists()
      expect(targetExists).toBe(false)
      expect(await Auth.get("oc-import-api")).toBeUndefined()
    } finally {
      await sandbox[Symbol.asyncDispose]()
    }
  })

  test("writes .zee config and auth entries when not in dry-run mode", async () => {
    const sandbox = await tmpdir()
    try {
      const sourceDir = path.join(sandbox.path, ".opencode")
      await Bun.write(
        path.join(sourceDir, "opencode.jsonc"),
        `{
  "models": {
    "url": "https://models.alt.example",
    "path": "./models.local.json"
  },
  "server": {
    "port": 4100,
    "hostname": "127.0.0.1",
    "mdns": true,
    "cors": ["https://console.example"]
  },
  "providers": {
    "oc-write-provider": {
      "apiKey": "sk-write",
      "timeout": 30000,
      "setCacheKey": true
    },
    "oc-write-oauth": {
      "oauth": {
        "refresh": "refresh-write",
        "access": "access-write",
        "expires": 1730000000
      }
    }
  }
}`,
      )

      const report = await importOpencodeConfig({
        cwd: sandbox.path,
      })

      expect(report.dryRun).toBe(false)
      expect(report.configEditCount).toBeGreaterThan(0)
      expect(report.authProviders).toEqual(["oc-write-provider", "oc-write-oauth"])

      const targetPath = path.join(sandbox.path, ".zee", "zee.jsonc")
      const targetText = await Bun.file(targetPath).text()
      const parsed = parseJsonc(targetText) as Record<string, unknown>
      expect(parsed.models).toEqual({
        url: "https://models.alt.example",
        path: "./models.local.json",
      })
      expect(parsed.server).toEqual({
        port: 4100,
        hostname: "127.0.0.1",
        mdns: true,
        cors: ["https://console.example"],
      })
      expect((parsed.provider as Record<string, any>)["oc-write-provider"].options).toEqual({
        timeout: 30000,
        setCacheKey: true,
      })

      const apiAuth = await Auth.get("oc-write-provider")
      expect(apiAuth).toEqual({
        type: "api",
        key: "sk-write",
      })

      const oauthAuth = await Auth.get("oc-write-oauth")
      expect(oauthAuth).toEqual({
        type: "oauth",
        refresh: "refresh-write",
        access: "access-write",
        expires: 1_730_000_000_000,
      })
    } finally {
      await sandbox[Symbol.asyncDispose]()
    }
  })

  test("fails with actionable diagnostics on invalid JSONC", async () => {
    const sandbox = await tmpdir()
    try {
      const sourceDir = path.join(sandbox.path, ".opencode")
      await Bun.write(path.join(sourceDir, "opencode.jsonc"), `{"providers": {"x": {"apiKey": "k", }}`)

      await expect(
        importOpencodeConfig({
          cwd: sandbox.path,
        }),
      ).rejects.toThrow("Invalid JSONC")
    } finally {
      await sandbox[Symbol.asyncDispose]()
    }
  })
})
