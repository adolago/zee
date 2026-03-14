import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

const unifiedModulePath = import.meta.resolve("../../../../src/memory/unified.ts")
const qdrantModulePath = import.meta.resolve("../../../../src/memory/qdrant.ts")
const embeddingModulePath = import.meta.resolve("../../../../src/memory/embedding.ts")
const runtimeConfigModulePath = import.meta.resolve("../../../../src/config/runtime.ts")
const providersModulePath = import.meta.resolve("../../../../src/config/providers.ts")
const logModulePath = import.meta.resolve("../../src/util/log.ts")
const globalDirsModulePath = import.meta.resolve("../../src/global/dirs.ts")

const CANONICAL_COLLECTION = "agent_memory"
const PREVIEW_LEGACY_COLLECTION = "agent_memory_gemini_embedding_2_preview_3072"
const PERSONAS_COLLECTION = "personas_memory"

type StoredPoint = {
  id: string
  payload: Record<string, unknown>
  vector?: number[]
}

const storageState = {
  dimensions: new Map<string, number>(),
  points: new Map<string, Map<string, StoredPoint>>(),
  createCalls: [] as Array<{ name: string; dimension: number }>,
  deleteCalls: [] as string[],
  insertCalls: [] as Array<{ collection: string; ids: string[] }>,
  setCalls: [] as string[],
}

const runtimeState = {
  embeddingConfig: {
    provider: "google",
    model: "gemini-embedding-2-preview",
    dimensions: 3072,
  },
  migrationHints: {
    configuredCollection: undefined as string | undefined,
    configuredEmbeddingProfile: undefined as string | undefined,
    configuredEmbeddingModel: undefined as string | undefined,
    configuredEmbeddingDimensions: undefined as number | undefined,
  },
}

function vector(fill: number, length = 3072): number[] {
  return new Array(length).fill(fill)
}

function getCollectionPoints(name: string): Map<string, StoredPoint> {
  let collection = storageState.points.get(name)
  if (!collection) {
    collection = new Map()
    storageState.points.set(name, collection)
  }
  return collection
}

function seedCollection(name: string, dimension: number, points: StoredPoint[]): void {
  storageState.dimensions.set(name, dimension)
  const collection = getCollectionPoints(name)
  collection.clear()
  for (const point of points) {
    collection.set(point.id, point)
  }
}

function matchesFilter(payload: Record<string, unknown>, filter?: Record<string, unknown>): boolean {
  if (!filter) return true
  return Object.entries(filter).every(([key, value]) => payload[key] === value)
}

class MockQdrantVectorStorage {
  private currentCollection: string

  constructor(config: { collection?: string }) {
    this.currentCollection = config.collection ?? CANONICAL_COLLECTION
  }

  async getCollectionDimension(name: string): Promise<number | null> {
    return storageState.dimensions.get(name) ?? null
  }

  async getCollectionPointCount(name: string): Promise<number | null> {
    return storageState.points.get(name)?.size ?? 0
  }

  async createCollection(name: string, dimension: number): Promise<void> {
    storageState.createCalls.push({ name, dimension })
    const existingDimension = storageState.dimensions.get(name)
    if (existingDimension && existingDimension !== dimension) {
      throw new Error(`Qdrant collection "${name}" has dimension ${existingDimension}, expected ${dimension}.`)
    }
    storageState.dimensions.set(name, dimension)
    getCollectionPoints(name)
    this.currentCollection = name
  }

  async deleteCollection(name: string): Promise<void> {
    storageState.deleteCalls.push(name)
    storageState.dimensions.delete(name)
    storageState.points.delete(name)
    if (this.currentCollection === name) {
      this.currentCollection = CANONICAL_COLLECTION
    }
  }

  async insert(entries: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>): Promise<void> {
    storageState.insertCalls.push({
      collection: this.currentCollection,
      ids: entries.map((entry) => entry.id),
    })
    const collection = getCollectionPoints(this.currentCollection)
    for (const entry of entries) {
      collection.set(entry.id, {
        id: entry.id,
        vector: entry.vector,
        payload: entry.payload,
      })
    }
  }

  async scroll(options: {
    filter?: Record<string, unknown>
    withPayload?: boolean
    withVector?: boolean
  } = {}): Promise<{
    points: Array<{ id: string; payload: Record<string, unknown>; vector?: number[] }>
    nextOffset?: string | number | null
  }> {
    const points = Array.from(getCollectionPoints(this.currentCollection).values())
      .filter((point) => matchesFilter(point.payload, options.filter))
      .map((point) => ({
        id: point.id,
        payload: options.withPayload === false ? {} : point.payload,
        vector: options.withVector === false ? undefined : point.vector,
      }))

    return {
      points,
      nextOffset: null,
    }
  }

  setCollection(name: string): void {
    storageState.setCalls.push(name)
    this.currentCollection = name
  }

  getCollection(): string {
    return this.currentCollection
  }
}

mock.module(qdrantModulePath, () => ({
  QdrantVectorStorage: MockQdrantVectorStorage,
}))

mock.module(embeddingModulePath, () => ({
  createEmbeddingProvider: () => ({
    id: "google",
    model: runtimeState.embeddingConfig.model,
    dimension: runtimeState.embeddingConfig.dimensions,
    embed: async (text: string) => {
      const values = vector(0)
      values[0] = text.length
      return values
    },
    embedBatch: async (texts: string[]) =>
      texts.map((text) => {
        const values = vector(0)
        values[0] = text.length
        return values
      }),
  }),
}))

mock.module(runtimeConfigModulePath, () => ({
  getMemoryQdrantConfig: () => ({
    collection: CANONICAL_COLLECTION,
  }),
  getMemoryEmbeddingConfig: () => runtimeState.embeddingConfig,
  getMemoryMigrationHints: () => runtimeState.migrationHints,
  getMemoryLocalIndexConfig: () => ({
    enabled: false,
    backend: "sqlite-fts",
    degradedRead: "off",
  }),
  getMemoryRerankerConfig: () => ({
    enabled: false,
  }),
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
    storageState.points.clear()
    storageState.createCalls.length = 0
    storageState.deleteCalls.length = 0
    storageState.insertCalls.length = 0
    storageState.setCalls.length = 0
    runtimeState.embeddingConfig = {
      provider: "google",
      model: "gemini-embedding-2-preview",
      dimensions: 3072,
    }
    runtimeState.migrationHints = {
      configuredCollection: undefined,
      configuredEmbeddingProfile: undefined,
      configuredEmbeddingModel: undefined,
      configuredEmbeddingDimensions: undefined,
    }
    resetMemory()
  })

  afterEach(() => {
    resetMemory()
  })

  test("migrates unsigned personas_memory entries into canonical agent_memory", async () => {
    seedCollection(PERSONAS_COLLECTION, 3072, [
      {
        id: "persona_note",
        payload: {
          type: "memory",
          category: "note",
          content: "legacy persona note",
          summary: "legacy summary",
          createdAt: 10,
          accessedAt: 10,
          namespace: "default",
        },
      },
    ])

    const memory = new Memory()
    await memory.init()

    const migrated = getCollectionPoints(CANONICAL_COLLECTION).get("persona_note")
    expect(memory.isAvailable()).toBe(true)
    expect((memory as any).collection).toBe(CANONICAL_COLLECTION)
    expect(migrated?.payload.embeddingModel).toBe("gemini-embedding-2-preview")
    expect(migrated?.payload.embeddingDimensions).toBe(3072)
    expect(migrated?.payload.content).toBe("legacy persona note")
    expect(storageState.points.get(PERSONAS_COLLECTION)?.size).toBe(1)
  })

  test("migrates the preview-specific legacy collection into canonical agent_memory", async () => {
    seedCollection(PREVIEW_LEGACY_COLLECTION, 3072, [
      {
        id: "preview_note",
        vector: vector(7),
        payload: {
          type: "memory",
          category: "note",
          content: "preview note",
          createdAt: 20,
          accessedAt: 20,
          namespace: "default",
          embeddingModel: "gemini-embedding-2-preview",
          embeddingDimensions: 3072,
        },
      },
    ])

    const memory = new Memory()
    await memory.init()

    const migrated = getCollectionPoints(CANONICAL_COLLECTION).get("preview_note")
    expect(memory.isAvailable()).toBe(true)
    expect(migrated?.vector?.[0]).toBe(7)
    expect(migrated?.payload.embeddingModel).toBe("gemini-embedding-2-preview")
    expect(storageState.points.get(PREVIEW_LEGACY_COLLECTION)?.size).toBe(1)
  })

  test("prefers signed canonical entries over legacy duplicates during migration", async () => {
    seedCollection(CANONICAL_COLLECTION, 3072, [
      {
        id: "dup_note",
        vector: vector(5),
        payload: {
          type: "memory",
          category: "note",
          content: "canonical winner",
          createdAt: 30,
          accessedAt: 30,
          namespace: "default",
          embeddingModel: "gemini-embedding-2-preview",
          embeddingDimensions: 3072,
        },
      },
    ])
    seedCollection(PERSONAS_COLLECTION, 3072, [
      {
        id: "dup_note",
        payload: {
          type: "memory",
          category: "note",
          content: "legacy loser",
          createdAt: 15,
          accessedAt: 15,
          namespace: "default",
        },
      },
    ])

    const memory = new Memory()
    await memory.init()

    const migrated = getCollectionPoints(CANONICAL_COLLECTION).get("dup_note")
    expect(memory.isAvailable()).toBe(true)
    expect(migrated?.payload.content).toBe("canonical winner")
    expect(migrated?.vector?.[0]).toBe(5)
  })

  test("rewrites canonical legacy signatures to the preview signature", async () => {
    seedCollection(CANONICAL_COLLECTION, 3072, [
      {
        id: "legacy_signed",
        payload: {
          type: "memory",
          category: "note",
          content: "legacy model payload",
          createdAt: 40,
          accessedAt: 40,
          namespace: "default",
          embeddingModel: "gemini-embedding-001",
          embeddingDimensions: 3072,
        },
        vector: vector(2),
      },
    ])

    const memory = new Memory()
    await memory.init()

    const migrated = getCollectionPoints(CANONICAL_COLLECTION).get("legacy_signed")
    expect(memory.isAvailable()).toBe(true)
    expect(migrated?.payload.embeddingModel).toBe("gemini-embedding-2-preview")
    expect(migrated?.payload.embeddingDimensions).toBe(3072)
  })

  test("migrates from a configured custom collection hint into canonical agent_memory", async () => {
    runtimeState.migrationHints.configuredCollection = "custom_memory"
    seedCollection("custom_memory", 3072, [
      {
        id: "custom_note",
        payload: {
          type: "memory",
          category: "note",
          content: "from custom collection",
          createdAt: 50,
          accessedAt: 50,
          namespace: "default",
        },
      },
    ])

    const memory = new Memory()
    await memory.init()

    const migrated = getCollectionPoints(CANONICAL_COLLECTION).get("custom_note")
    expect(memory.isAvailable()).toBe(true)
    expect(migrated?.payload.content).toBe("from custom collection")
    expect((memory as any).collection).toBe(CANONICAL_COLLECTION)
  })
})
