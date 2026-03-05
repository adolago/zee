import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { ModelsDev } from "../../src/provider/models"
import { reloadFlags } from "../../src/flag/flag"

const ORIGINAL_ENV = {
  ZEE_MODELS_PATH: process.env.ZEE_MODELS_PATH,
  AGENT_CORE_MODELS_PATH: process.env.AGENT_CORE_MODELS_PATH,
}

beforeAll(async () => {
  const filepath = path.join(process.env.XDG_CACHE_HOME ?? "/tmp", "zee-test-models.json")
  await Bun.write(
    filepath,
    JSON.stringify({
      test: {
        api: "https://example.invalid",
        name: "Test Provider",
        env: [],
        id: "test",
        models: {},
      },
    }),
  )

  process.env.ZEE_MODELS_PATH = filepath
  reloadFlags()
  ModelsDev.Data.reset()
})

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
  ModelsDev.configure()
  ModelsDev.Data.reset()
})

describe("ModelsDev", () => {
  test("reads model catalog from ZEE_MODELS_PATH when set", async () => {
    const data = await ModelsDev.get()
    expect(data).toBeDefined()
    expect(Object.keys(data)).toContain("test")
    expect(data.test?.name).toBe("Test Provider")
  })

  test("reads model catalog from configured path when env path is unset", async () => {
    const configuredFilepath = path.join(process.env.XDG_CACHE_HOME ?? "/tmp", "zee-test-models-config-path.json")
    await Bun.write(
      configuredFilepath,
      JSON.stringify({
        configured: {
          api: "https://example.invalid",
          name: "Configured Provider",
          env: [],
          id: "configured",
          models: {},
        },
      }),
    )

    const originalPath = process.env.ZEE_MODELS_PATH
    try {
      delete process.env.ZEE_MODELS_PATH
      reloadFlags()
      ModelsDev.configure({ path: configuredFilepath })

      const data = await ModelsDev.get()
      expect(data).toBeDefined()
      expect(Object.keys(data)).toContain("configured")
      expect(data.configured?.name).toBe("Configured Provider")
    } finally {
      if (originalPath === undefined) delete process.env.ZEE_MODELS_PATH
      else process.env.ZEE_MODELS_PATH = originalPath
      reloadFlags()
      ModelsDev.configure()
      ModelsDev.Data.reset()
    }
  })

  test("reads model catalog from AGENT_CORE_MODELS_PATH alias when Zee path is unset", async () => {
    const aliasFilepath = path.join(process.env.XDG_CACHE_HOME ?? "/tmp", "zee-test-models-alias-path.json")
    await Bun.write(
      aliasFilepath,
      JSON.stringify({
        alias: {
          api: "https://example.invalid",
          name: "Alias Provider",
          env: [],
          id: "alias",
          models: {},
        },
      }),
    )

    const originalZeePath = process.env.ZEE_MODELS_PATH
    const originalAliasPath = process.env.AGENT_CORE_MODELS_PATH
    try {
      delete process.env.ZEE_MODELS_PATH
      process.env.AGENT_CORE_MODELS_PATH = aliasFilepath
      reloadFlags()
      ModelsDev.configure()
      ModelsDev.Data.reset()

      const data = await ModelsDev.get()
      expect(data).toBeDefined()
      expect(Object.keys(data)).toContain("alias")
      expect(data.alias?.name).toBe("Alias Provider")
    } finally {
      if (originalZeePath === undefined) delete process.env.ZEE_MODELS_PATH
      else process.env.ZEE_MODELS_PATH = originalZeePath
      if (originalAliasPath === undefined) delete process.env.AGENT_CORE_MODELS_PATH
      else process.env.AGENT_CORE_MODELS_PATH = originalAliasPath
      reloadFlags()
      ModelsDev.configure()
      ModelsDev.Data.reset()
    }
  })
})
