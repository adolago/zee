import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { FetchContentTool } from "../../src/tool/fetch_content"
import { GetSearchContentTool } from "../../src/tool/get_search_content"
import { getSearchContentResponse } from "../../src/tool/content-store"

const originalFetch = globalThis.fetch

const baseCtx = {
  sessionID: "test-session",
  messageID: "test-message",
  callID: "test-call",
  agent: "zee",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const ctx = (dir: string) => ({ ...baseCtx, directory: dir, worktree: dir })

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("tool.fetch_content", () => {
  test("stores extracted html content and retrieves it by responseId", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url === "https://example.com/article") {
        return new Response(
          "<html><head><title>Example</title></head><body><h1>Hello from example</h1></body></html>",
          {
            status: 200,
            headers: {
              "content-type": "text/html; charset=utf-8",
            },
          },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetchTool = await FetchContentTool.init()
        const getTool = await GetSearchContentTool.init()

        const fetched = await fetchTool.execute(
          { url: "https://example.com/article", forceClone: false },
          ctx(tmp.path),
        )
        const responseId = String((fetched.metadata as any).responseId)
        expect(responseId.startsWith("tool_")).toBe(true)

        const retrieved = await getTool.execute({ responseId }, ctx(tmp.path))
        expect(retrieved.output).toContain("Hello from example")
        expect(retrieved.output).toContain("responseId:")
      },
    })
  })

  test("supports mixed success/failure for multi-url fetches", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url === "https://example.com/good") {
        return new Response("good body", {
          status: 200,
          headers: {
            "content-type": "text/plain",
          },
        })
      }
      if (url === "https://example.com/bad") {
        return new Response("not found", { status: 404 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetchTool = await FetchContentTool.init()
        const getTool = await GetSearchContentTool.init()

        const fetched = await fetchTool.execute(
          { urls: ["https://example.com/good", "https://example.com/bad"], forceClone: false },
          ctx(tmp.path),
        )
        expect((fetched.metadata as any).itemCount).toBe(1)
        expect((fetched.metadata as any).failureCount).toBe(1)
        expect(fetched.output).toContain("Failures (1):")

        const responseId = String((fetched.metadata as any).responseId)
        const retrieved = await getTool.execute({ responseId }, ctx(tmp.path))
        expect(retrieved.output).toContain("good body")
      },
    })
  })

  test("uses cf-markdown extraction for text/markdown responses", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url === "https://example.com/cf-markdown") {
        return new Response("# Heading\n\nCloudflare markdown body.", {
          status: 200,
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "x-markdown-tokens": "1234",
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetchTool = await FetchContentTool.init()
        const getTool = await GetSearchContentTool.init()

        const fetched = await fetchTool.execute(
          { url: "https://example.com/cf-markdown", forceClone: false },
          ctx(tmp.path),
        )
        const responseId = String((fetched.metadata as any).responseId)
        const response = await getSearchContentResponse(baseCtx.sessionID, responseId)

        expect(response.items[0].meta).toMatchObject({
          extraction: "cf-markdown",
        })

        const retrieved = await getTool.execute({ responseId }, ctx(tmp.path))
        expect(retrieved.output).toContain("Heading")
        expect(retrieved.output).toContain("Cloudflare markdown body.")
      },
    })
  })

  test("extracts github repository overview via GitHub API", async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url === "https://api.github.com/repos/octo/demo") {
        return new Response(
          JSON.stringify({
            default_branch: "main",
            description: "Demo repository",
            html_url: "https://github.com/octo/demo",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      }
      if (url === "https://api.github.com/repos/octo/demo/contents") {
        return new Response(JSON.stringify([{ type: "file", name: "README.md", size: 321 }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (url === "https://api.github.com/repos/octo/demo/readme?ref=main") {
        expect((init?.headers as Record<string, string>)?.Accept).toContain("application/vnd.github.raw")
        return new Response("# Demo README", {
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetchTool = await FetchContentTool.init()
        const getTool = await GetSearchContentTool.init()

        const fetched = await fetchTool.execute(
          { url: "https://github.com/octo/demo", forceClone: false },
          ctx(tmp.path),
        )
        const responseId = String((fetched.metadata as any).responseId)
        const retrieved = await getTool.execute({ responseId }, ctx(tmp.path))

        expect(retrieved.output).toContain("GitHub repository overview: octo/demo")
        expect(retrieved.output).toContain("Demo README")
      },
    })
  })

  test("handles pdf urls using reader fallback extraction", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url === "https://docs.example.com/file.pdf") {
        return new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: {
            "content-type": "application/pdf",
          },
        })
      }
      if (url === "https://r.jina.ai/https://docs.example.com/file.pdf") {
        return new Response("PDF extracted text", {
          status: 200,
          headers: {
            "content-type": "text/plain",
          },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetchTool = await FetchContentTool.init()
        const getTool = await GetSearchContentTool.init()

        const fetched = await fetchTool.execute(
          { url: "https://docs.example.com/file.pdf", forceClone: false },
          ctx(tmp.path),
        )
        const responseId = String((fetched.metadata as any).responseId)
        const retrieved = await getTool.execute({ responseId }, ctx(tmp.path))

        expect(retrieved.output).toContain("PDF extracted text")
      },
    })
  })

  test("selects stored content by urlIndex and url", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = requestUrl(input)
      if (url === "https://example.com/one") {
        return new Response("first content", { status: 200, headers: { "content-type": "text/plain" } })
      }
      if (url === "https://example.com/two") {
        return new Response("second content", { status: 200, headers: { "content-type": "text/plain" } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetchTool = await FetchContentTool.init()
        const getTool = await GetSearchContentTool.init()

        const fetched = await fetchTool.execute(
          { urls: ["https://example.com/one", "https://example.com/two"], forceClone: false },
          ctx(tmp.path),
        )
        const responseId = String((fetched.metadata as any).responseId)

        const secondByIndex = await getTool.execute({ responseId, urlIndex: 1 }, ctx(tmp.path))
        expect(secondByIndex.output).toContain("second content")

        const secondByUrl = await getTool.execute({ responseId, url: "https://example.com/two" }, ctx(tmp.path))
        expect(secondByUrl.output).toContain("second content")
      },
    })
  })

  test("rejects private and special-use targets before fetching", async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response("should-not-fetch", { status: 200 })
    }) as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetchTool = await FetchContentTool.init()
        await expect(fetchTool.execute({ url: "http://[ff02::1]/", forceClone: false }, ctx(tmp.path))).rejects.toThrow(
          /Blocked URL target/,
        )
      },
    })

    expect(fetchCalled).toBe(false)
  })
})
