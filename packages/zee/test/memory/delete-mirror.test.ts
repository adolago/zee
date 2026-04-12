import { describe, expect, test } from "bun:test"
import { Memory, type MemoryCategory } from "../../../../src/memory/unified"

type ScrollPage = {
  points: Array<{ id: string; payload: Record<string, unknown> }>
  nextOffset?: string | number | null
}

type Harness = {
  memory: Memory
  calls: {
    init: number
    scroll: Array<Record<string, unknown>>
    delete: string[][]
    ftsDelete: string[][]
  }
}

function point(id: string): { id: string; payload: Record<string, unknown> } {
  return { id, payload: {} }
}

function createHarness(options: {
  pages: ScrollPage[]
  withFts?: boolean
  ftsThrows?: boolean
}): Harness {
  const memory = new Memory({
    storage: { collection: "delete-mirror-test" },
    embedding: { provider: "local", dimensions: 384 },
    namespace: "test",
  })

  const calls: Harness["calls"] = {
    init: 0,
    scroll: [],
    delete: [],
    ftsDelete: [],
  }

  let pageCursor = 0
  const storage = {
    scroll: async (opts: Record<string, unknown>) => {
      calls.scroll.push(opts)
      const page = options.pages[pageCursor++] ?? { points: [], nextOffset: null }
      return page
    },
    delete: async (ids: string[]) => {
      calls.delete.push([...ids])
    },
  }

  const ftsStore = options.withFts
    ? {
        deleteBatch: (ids: string[]) => {
          calls.ftsDelete.push([...ids])
          if (options.ftsThrows) {
            throw new Error("fts delete failed")
          }
        },
      }
    : undefined

  const memoryAny = memory as any
  memoryAny.init = async () => {
    calls.init += 1
  }
  memoryAny.storage = storage
  memoryAny.ftsStore = ftsStore

  return { memory, calls }
}

describe("Memory bulk-delete mirror sync", () => {
  test("deleteWhere removes matching IDs from local vector storage and SQLite FTS", async () => {
    const { memory, calls } = createHarness({
      pages: [{ points: [point("a"), point("b")], nextOffset: null }],
      withFts: true,
    })

    const deleted = await memory.deleteWhere({
      category: "fact",
      namespace: "zee",
      olderThan: 123,
    })

    expect(calls.init).toBe(1)
    expect(deleted).toBe(2)
    expect(calls.scroll).toEqual([
      {
        filter: {
          type: "memory",
          category: "fact",
          namespace: "zee",
          createdAt: { $lt: 123 },
        },
        limit: 500,
        withPayload: false,
      },
    ])
    expect(calls.delete).toEqual([["a", "b"]])
    expect(calls.ftsDelete).toEqual([["a", "b"]])
  })

  test("deleteWhere paginates through scroll offsets before deleting", async () => {
    const { memory, calls } = createHarness({
      pages: [
        { points: [point("a"), point("b")], nextOffset: "page-2" },
        { points: [point("c")], nextOffset: null },
      ],
      withFts: true,
    })

    const deleted = await memory.deleteWhere({ category: "note" as MemoryCategory })

    expect(deleted).toBe(3)
    expect(calls.scroll).toEqual([
      {
        filter: { type: "memory", category: "note" },
        limit: 500,
        withPayload: false,
      },
      {
        filter: { type: "memory", category: "note" },
        limit: 500,
        offset: "page-2",
        withPayload: false,
      },
    ])
    expect(calls.delete).toEqual([["a", "b", "c"]])
    expect(calls.ftsDelete).toEqual([["a", "b", "c"]])
  })

  test("deleteExpired uses expiry filter and mirrors deletes", async () => {
    const originalNow = Date.now
    Date.now = () => 5000

    try {
      const { memory, calls } = createHarness({
        pages: [{ points: [point("ttl-1")], nextOffset: null }],
        withFts: true,
      })

      const deleted = await memory.deleteExpired()

      expect(deleted).toBe(1)
      expect(calls.scroll).toEqual([
        {
          filter: {
            type: "memory",
            expiresAt: { $lt: 5000, $gt: 0 },
          },
          limit: 500,
          withPayload: false,
        },
      ])
      expect(calls.delete).toEqual([["ttl-1"]])
      expect(calls.ftsDelete).toEqual([["ttl-1"]])
    } finally {
      Date.now = originalNow
    }
  })

  test("continues when FTS batch delete fails (local vector storage remains source of truth)", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => point(`id-${i}`))
    const { memory, calls } = createHarness({
      pages: [{ points: ids, nextOffset: null }],
      withFts: true,
      ftsThrows: true,
    })

    const deleted = await memory.deleteWhere({})

    expect(deleted).toBe(250)
    expect(calls.delete).toEqual([
      ids.slice(0, 200).map((p) => p.id),
      ids.slice(200).map((p) => p.id),
    ])
    expect(calls.ftsDelete).toEqual([
      ids.slice(0, 200).map((p) => p.id),
      ids.slice(200).map((p) => p.id),
    ])
  })

  test("still bulk-deletes from local vector storage when local index is unavailable", async () => {
    const { memory, calls } = createHarness({
      pages: [{ points: [point("q-only")], nextOffset: null }],
      withFts: false,
    })

    const deleted = await memory.deleteWhere({ category: "decision" })

    expect(deleted).toBe(1)
    expect(calls.delete).toEqual([["q-only"]])
    expect(calls.ftsDelete).toEqual([])
  })

  test("returns zero and skips deletes when no points match", async () => {
    const { memory, calls } = createHarness({
      pages: [{ points: [], nextOffset: null }],
      withFts: true,
    })

    const deleted = await memory.deleteWhere({ category: "relationship" })

    expect(deleted).toBe(0)
    expect(calls.delete).toEqual([])
    expect(calls.ftsDelete).toEqual([])
  })
})
