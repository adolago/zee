import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ORIGINAL_ENV = {
  AGENT_CORE_INSTANCE_CACHE_MAX_INSTANCES: process.env.AGENT_CORE_INSTANCE_CACHE_MAX_INSTANCES,
  AGENT_CORE_INSTANCE_CACHE_TTL_SECONDS: process.env.AGENT_CORE_INSTANCE_CACHE_TTL_SECONDS,
  OPENCODE_INSTANCE_CACHE_MAX_INSTANCES: process.env.OPENCODE_INSTANCE_CACHE_MAX_INSTANCES,
  OPENCODE_INSTANCE_CACHE_TTL_SECONDS: process.env.OPENCODE_INSTANCE_CACHE_TTL_SECONDS,
}

beforeAll(() => {
  delete process.env.AGENT_CORE_INSTANCE_CACHE_MAX_INSTANCES
  delete process.env.AGENT_CORE_INSTANCE_CACHE_TTL_SECONDS
  delete process.env.OPENCODE_INSTANCE_CACHE_MAX_INSTANCES
  delete process.env.OPENCODE_INSTANCE_CACHE_TTL_SECONDS
  reloadFlags()
})

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
})

beforeEach(() => {
  delete process.env.AGENT_CORE_INSTANCE_CACHE_MAX_INSTANCES
  delete process.env.AGENT_CORE_INSTANCE_CACHE_TTL_SECONDS
  delete process.env.OPENCODE_INSTANCE_CACHE_MAX_INSTANCES
  delete process.env.OPENCODE_INSTANCE_CACHE_TTL_SECONDS
  reloadFlags()
})

afterEach(async () => {
  await Instance.disposeAll()
})

describe("Instance cache eviction", () => {
  test("evicts least recently used instances when max is exceeded", async () => {
    process.env.AGENT_CORE_INSTANCE_CACHE_MAX_INSTANCES = "2"
    reloadFlags()

    await using a = await tmpdir({ git: true })
    await using b = await tmpdir({ git: true })
    await using c = await tmpdir({ git: true })

    await Instance.provide({ directory: a.path, fn: async () => {} })
    await Instance.provide({ directory: b.path, fn: async () => {} })
    // Touch "a" again so "b" becomes the LRU entry.
    await Instance.provide({ directory: a.path, fn: async () => {} })
    await Instance.provide({ directory: c.path, fn: async () => {} })

    await Instance.evict()

    expect(Instance.cacheSize()).toBe(2)
    expect(Instance.isCached(a.path)).toBe(true)
    expect(Instance.isCached(c.path)).toBe(true)
    expect(Instance.isCached(b.path)).toBe(false)
  })

  test("evicts unused instances after TTL", async () => {
    process.env.AGENT_CORE_INSTANCE_CACHE_TTL_SECONDS = "1"
    reloadFlags()

    await using a = await tmpdir({ git: true })

    await Instance.provide({ directory: a.path, fn: async () => {} })
    expect(Instance.isCached(a.path)).toBe(true)

    await Bun.sleep(1100)
    await Instance.evict()

    expect(Instance.isCached(a.path)).toBe(false)
    expect(Instance.cacheSize()).toBe(0)
  })
})
