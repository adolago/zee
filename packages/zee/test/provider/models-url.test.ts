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
})
