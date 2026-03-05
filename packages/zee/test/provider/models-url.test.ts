import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { ModelsDev } from "../../src/provider/models"

const originalFetch = globalThis.fetch

afterEach(async () => {
  globalThis.fetch = originalFetch
  ModelsDev.configure()
  ModelsDev.Data.reset()
})

describe("ModelsDev", () => {
  test("refresh uses configured models URL", async () => {
    const catalogUrl = "https://catalog.example.invalid"
    const modelsPath = path.join(process.env.XDG_CACHE_HOME ?? "/tmp", "zee-test-models-url.json")
    await fs.rm(modelsPath, { force: true }).catch(() => {})

    let fetchedUrl: string | undefined
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetchedUrl = input.toString()
      return new Response(
        JSON.stringify({
          custom: {
            api: "https://example.invalid",
            name: "Custom Provider",
            env: [],
            id: "custom",
            models: {},
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    ModelsDev.configure({
      url: catalogUrl,
      path: modelsPath,
    })

    await ModelsDev.refresh({ timeoutMs: 5000 })
    const content = JSON.parse(await Bun.file(modelsPath).text()) as Record<string, { name?: string }>

    expect(fetchedUrl).toBe(`${catalogUrl}/api.json`)
    expect(content.custom?.name).toBe("Custom Provider")
  })

  test("refresh uses AGENT_CORE_MODELS_URL alias when Zee URL is unset", async () => {
    const aliasUrl = "https://alias-catalog.example.invalid"
    const modelsPath = path.join(process.env.XDG_CACHE_HOME ?? "/tmp", "zee-test-models-url-alias.json")
    await fs.rm(modelsPath, { force: true }).catch(() => {})

    const originalZeeUrl = process.env.ZEE_MODELS_URL
    const originalAliasUrl = process.env.AGENT_CORE_MODELS_URL

    let fetchedUrl: string | undefined
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetchedUrl = input.toString()
      return new Response(
        JSON.stringify({
          aliascustom: {
            api: "https://example.invalid",
            name: "Alias Custom Provider",
            env: [],
            id: "aliascustom",
            models: {},
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    try {
      delete process.env.ZEE_MODELS_URL
      process.env.AGENT_CORE_MODELS_URL = aliasUrl
      ModelsDev.configure({ path: modelsPath })
      ModelsDev.Data.reset()

      await ModelsDev.refresh({ timeoutMs: 5000 })
      const content = JSON.parse(await Bun.file(modelsPath).text()) as Record<string, { name?: string }>

      expect(fetchedUrl).toBe(`${aliasUrl}/api.json`)
      expect(content.aliascustom?.name).toBe("Alias Custom Provider")
    } finally {
      if (originalZeeUrl === undefined) delete process.env.ZEE_MODELS_URL
      else process.env.ZEE_MODELS_URL = originalZeeUrl
      if (originalAliasUrl === undefined) delete process.env.AGENT_CORE_MODELS_URL
      else process.env.AGENT_CORE_MODELS_URL = originalAliasUrl
      ModelsDev.configure()
      ModelsDev.Data.reset()
    }
  })
})
