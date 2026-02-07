import { afterEach, describe, expect, test } from "bun:test"
import { VoyageEmbeddingProvider } from "../../../../src/memory/embedding"

const originalFetch = globalThis.fetch
const originalEnv = process.env

afterEach(() => {
  globalThis.fetch = originalFetch
  process.env = originalEnv
})

describe("VoyageEmbeddingProvider input_type", () => {
  test("uses input_type=query for embed()", async () => {
    process.env = { ...originalEnv, VOYAGE_API_KEY: "test-key" }

    const fetchMock = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      expect(body.input_type).toBe("query")

      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ embedding: [1, 2, 3], index: 0 }],
        }),
      } as any
    }) as typeof fetch

    globalThis.fetch = fetchMock
    const provider = new VoyageEmbeddingProvider({})
    await provider.embed("hello")
  })

  test("uses input_type=document for embedBatch()", async () => {
    process.env = { ...originalEnv, VOYAGE_API_KEY: "test-key" }

    const fetchMock = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      expect(body.input_type).toBe("document")

      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { embedding: [1, 2, 3], index: 0 },
            { embedding: [4, 5, 6], index: 1 },
          ],
        }),
      } as any
    }) as typeof fetch

    globalThis.fetch = fetchMock
    const provider = new VoyageEmbeddingProvider({})
    await provider.embedBatch(["a", "b"])
  })
})

