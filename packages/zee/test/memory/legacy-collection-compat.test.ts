import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const unifiedModulePath = import.meta.resolve("../../../../src/memory/unified.ts")
const qdrantModulePath = import.meta.resolve("../../../../src/memory/qdrant.ts")
const embeddingModulePath = import.meta.resolve("../../../../src/memory/embedding.ts")
const runtimeConfigModulePath = import.meta.resolve("../../../../src/config/runtime.ts")
const providersModulePath = import.meta.resolve("../../../../src/config/providers.ts")
const logModulePath = import.meta.resolve("../../src/util/log.ts")
const globalDirsModulePath = import.meta.resolve("../../src/global/dirs.ts")

const storageState = {
  dimensions: new Map<string, number>(),
  pointCounts: new Map<string, number>(),
  createCalls: [] as Array<{ name: string; dimension: number }>,
  setCalls: [] as string[],
}

const runtimeState = {
  userConfiguredCollection: false,
}

class MockQdrantVectorStorage {
  private currentCollection: string

  constructor(config: { collection?: string }) {
    this.currentCollection = config.collection ?? "agent_memory"
  }

  async getCollectionDimension(name: string): Promise<number | null> {
    return storageState.dimensions.get(name) ?? null
  }

  async getCollectionPointCount(name: string): Promise<number | null> {
    return storageState.pointCounts.get(name) ?? null
  }

  async createCollection(name: string, dimension: number): Promise<void> {
    storageState.createCalls.push({ name, dimension })
    const existing = storageState.dimensions.get(name)
    if (existing && existing !== dimension) {
      throw new Error(`Qdrant collection "${name}" has dimension ${existing}, expected ${dimension}.`)
    }
    storageState.dimensions.set(name, dimension)
    this.currentCollection = name
  }

  setCollection(name: string): void {
    storageState.setCalls.push(name)
    this.currentCollection = name
  }

  async count(): Promise<number> {
    return storageState.pointCounts.get(this.currentCollection) ?? 0
  }
}

mock.module(qdrantModulePath, () => ({
  QdrantVectorStorage: MockQdrantVectorStorage,
}))

mock.module(embeddingModulePath, () => ({
  createEmbeddingProvider: () => ({
    id: "google",
    model: "gemini-embedding-001",
    dimension: 3072,
    embed: async () => new Array(3072).fill(0),
    embedBatch: async (texts: string[]) => texts.map(() => new Array(3072).fill(0)),
  }),
  createEmbeddingProviderAsync: async () => ({
    id: "google",
    model: "gemini-embedding-001",
    dimension: 3072,
    embed: async () => new Array(3072).fill(0),
    embedBatch: async (texts: string[]) => texts.map(() => new Array(3072).fill(0)),
  }),
}))

mock.module(runtimeConfigModulePath, () => ({
  getMemoryQdrantConfig: () => ({}),
  getMemoryEmbeddingConfig: () => ({
    provider: "google",
    model: "gemini-embedding-001",
    dimensions: 3072,
  }),
  getMemoryLocalIndexConfig: () => ({
    enabled: false,
    backend: "sqlite-fts",
    degradedRead: "off",
  }),
  getMemoryRerankerConfig: () => ({
    enabled: false,
  }),
  isMemoryQdrantCollectionConfiguredByUser: () => runtimeState.userConfiguredCollection,
}))

mock.module(providersModulePath, () => ({
  getAuthApiKeySync: () => "test-key",
}))

mock.module(logModulePath, () => {
  const noop = () => {}
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    tag: () => logger,
    clone: () => logger,
    time: () => ({ stop: noop, [Symbol.dispose]: noop }),
  }
  return {
    Log: {
      create: () => logger,
      Default: logger,
      Level: { parse: (value: string) => value },
      init: async () => {},
      file: () => "",
    },
  }
})

mock.module(globalDirsModulePath, () => ({
  resolveStateDir: () => "/tmp/zee-test-state",
}))

const { Memory, resetMemory } = await import(unifiedModulePath)

describe("Memory legacy collection compatibility", () => {
  beforeEach(() => {
    storageState.dimensions.clear()
    storageState.pointCounts.clear()
    storageState.createCalls.length = 0
    storageState.setCalls.length = 0
    runtimeState.userConfiguredCollection = false
    resetMemory()
  })

  afterEach(() => {
    resetMemory()
  })

  test("adopts populated legacy personas_memory when default agent_memory is stale and incompatible", async () => {
    storageState.dimensions.set("agent_memory", 384)
    storageState.pointCounts.set("agent_memory", 0)
    storageState.dimensions.set("personas_memory", 3072)
    storageState.pointCounts.set("personas_memory", 74)

    const memory = new Memory()
    await memory.init()

    expect(memory.isAvailable()).toBe(true)
    expect((memory as any).collection).toBe("personas_memory")
    expect(storageState.createCalls).toContainEqual({ name: "personas_memory", dimension: 3072 })
    expect(storageState.setCalls.at(-1)).toBe("personas_memory")
  })

  test("does not silently switch when agent_memory already contains data", async () => {
    storageState.dimensions.set("agent_memory", 384)
    storageState.pointCounts.set("agent_memory", 5)
    storageState.dimensions.set("personas_memory", 3072)
    storageState.pointCounts.set("personas_memory", 74)

    const memory = new Memory()
    await memory.init()

    expect(memory.isAvailable()).toBe(false)
    expect((memory as any).collection).toBe("agent_memory")
    expect(storageState.setCalls).not.toContain("personas_memory")
  })

  test("does not switch when the collection was explicitly configured by the user", async () => {
    runtimeState.userConfiguredCollection = true
    storageState.dimensions.set("agent_memory", 384)
    storageState.pointCounts.set("agent_memory", 0)
    storageState.dimensions.set("personas_memory", 3072)
    storageState.pointCounts.set("personas_memory", 74)

    const memory = new Memory()
    await memory.init()

    expect(memory.isAvailable()).toBe(false)
    expect((memory as any).collection).toBe("agent_memory")
    expect(storageState.setCalls).not.toContain("personas_memory")
  })
})
