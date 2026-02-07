import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { ModelsDev } from "../../src/provider/models"
import { reloadFlags } from "../../src/flag/flag"

const ORIGINAL_ENV = {
  AGENT_CORE_MODELS_PATH: process.env.AGENT_CORE_MODELS_PATH,
}

beforeAll(async () => {
  const filepath = path.join(process.env.XDG_CACHE_HOME ?? "/tmp", "agent-core-test-models.json")
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

  process.env.AGENT_CORE_MODELS_PATH = filepath
  reloadFlags()
  ModelsDev.Data.reset()
})

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
  ModelsDev.Data.reset()
})

describe("ModelsDev", () => {
  test("reads model catalog from AGENT_CORE_MODELS_PATH when set", async () => {
    const data = await ModelsDev.get()
    expect(data).toBeDefined()
    expect(Object.keys(data)).toContain("test")
    expect(data.test?.name).toBe("Test Provider")
  })
})
