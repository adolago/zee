import { afterEach, describe, expect, test } from "bun:test"
import { WebFetchTool } from "../../src/tool/webfetch"
import { markdownToPlainText, redactUrlForDebugLog } from "../../src/tool/fetch-helpers"

const originalFetch = globalThis.fetch

const ctx = {
  sessionID: "test-session",
  messageID: "test-message",
  callID: "test-call",
  agent: "zee",
  abort: AbortSignal.any([]),
  directory: process.cwd(),
  worktree: process.cwd(),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  if (Array.isArray(headers)) {
    const hit = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return hit?.[1]
  }
  const obj = headers as Record<string, string>
  return obj[name] ?? obj[name.toLowerCase()] ?? obj[name.toUpperCase()]
}

describe("tool.webfetch", () => {
  test("prefers markdown accept header in markdown mode", async () => {
    let acceptHeader: string | undefined
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      acceptHeader = headerValue(init, "Accept")
      return new Response("# Hello", {
        status: 200,
        headers: {
          "content-type": "text/markdown",
        },
      })
    }) as typeof fetch

    const tool = await WebFetchTool.init()
    await tool.execute({ url: "https://example.com", format: "markdown" }, ctx)

    expect(acceptHeader).toBe("text/markdown, text/html;q=0.9, */*;q=0.1")
  })

  test("marks markdown responses as cf-markdown extractor", async () => {
    globalThis.fetch = (async () => {
      return new Response("# CF Markdown\n\nHello from cf.", {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
        },
      })
    }) as typeof fetch

    const tool = await WebFetchTool.init()
    const result = await tool.execute({ url: "https://example.com", format: "markdown" }, ctx)

    expect(result.metadata).toMatchObject({
      extractor: "cf-markdown",
    })
    expect(result.output).toContain("CF Markdown")
    expect(result.output).toContain("Hello from cf.")
  })

  test("converts markdown to plain text in text mode", async () => {
    globalThis.fetch = (async () => {
      return new Response("# Heading\n\n**Bold text** and [a link](https://example.com).", {
        status: 200,
        headers: {
          "content-type": "text/markdown",
        },
      })
    }) as typeof fetch

    const tool = await WebFetchTool.init()
    const result = await tool.execute({ url: "https://example.com", format: "text" }, ctx)

    expect(result.metadata).toMatchObject({
      extractor: "cf-markdown",
    })
    expect(result.output).toContain("Heading")
    expect(result.output).toContain("Bold text and a link.")
    expect(result.output).not.toContain("# Heading")
    expect(result.output).not.toContain("[a link](https://example.com)")
  })

  test("rejects private and special-use targets before fetching", async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response("should-not-fetch", { status: 200 })
    }) as typeof fetch

    const tool = await WebFetchTool.init()
    await expect(tool.execute({ url: "http://[ff02::1]/", format: "markdown" }, ctx)).rejects.toThrow(
      /Blocked URL target/,
    )
    expect(fetchCalled).toBe(false)
  })
})

describe("fetch helpers", () => {
  test("redacts URL path and query for debug logs", () => {
    expect(redactUrlForDebugLog("https://example.com/private/path?token=secret#frag")).toBe("https://example.com/...")
    expect(redactUrlForDebugLog("https://example.com")).toBe("https://example.com")
  })

  test("strips markdown syntax to plain text", () => {
    const text = markdownToPlainText("## Title\n- **Bold** item with [link](https://example.com)")
    expect(text).toContain("Title")
    expect(text).toContain("Bold item with link")
    expect(text).not.toContain("**")
    expect(text).not.toContain("[link]")
  })
})
