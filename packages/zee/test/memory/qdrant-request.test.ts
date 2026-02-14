import { afterEach, describe, expect, test } from "bun:test"
import { QdrantVectorStorage } from "../../../../src/memory/qdrant"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("QdrantVectorStorage.request", () => {
  test("aborts a hung request via timeout", async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = Object.assign(new Error("aborted"), { name: "AbortError" })
          reject(err)
        })
      })
    }) as typeof fetch

    const storage = new QdrantVectorStorage({
      url: "http://localhost:6333",
      collection: "test",
      timeoutMs: 25,
      maxRetries: 0,
    })

    const action = (storage as any).request("GET", "/collections/test")
    await expect(action).rejects.toThrow(/timed out/i)
  })

  test("retries idempotent requests on network errors", async () => {
    let calls = 0
    globalThis.fetch = (async (_url: string) => {
      calls += 1
      if (calls === 1) {
        throw new Error("ECONNRESET")
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: 42 }),
      } as any
    }) as typeof fetch

    const storage = new QdrantVectorStorage({
      url: "http://localhost:6333",
      collection: "test",
      timeoutMs: 1000,
      maxRetries: 1,
    })

    const result = await (storage as any).request("GET", "/collections/test")
    expect(result).toBe(42)
    expect(calls).toBe(2)
  })

  test("does not retry on non-retryable statuses", async () => {
    let calls = 0
    globalThis.fetch = (async (_url: string) => {
      calls += 1
      return {
        ok: false,
        status: 400,
        text: async () => "bad request",
      } as any
    }) as typeof fetch

    const storage = new QdrantVectorStorage({
      url: "http://localhost:6333",
      collection: "test",
      timeoutMs: 1000,
      maxRetries: 2,
    })

    const action = (storage as any).request("GET", "/collections/test")
    await expect(action).rejects.toThrow(/failed \(400\)/)
    expect(calls).toBe(1)
  })
})
