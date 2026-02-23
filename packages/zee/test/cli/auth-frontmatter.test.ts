import { describe, expect, test } from "bun:test"
import {
  discoverOpenAICompatibleModels,
  extractAuthFromFrontmatter,
  normalizeLocalProviderBaseUrl,
  parseOpenAICompatibleModelIds,
  resolveLocalProviderBaseUrl,
} from "../../src/cli/cmd/auth"

describe("extractAuthFromFrontmatter", () => {
  test("merges requires.env with metadata hints and dedupes", () => {
    const result = extractAuthFromFrontmatter({
      requires: { env: ["TOP_ENV", "", 123, "TOP_ENV"] },
      metadata: {
        primaryEnv: "META_PRIMARY",
        requires: { env: ["META_ENV", "TOP_ENV"] },
        zee: { primaryEnv: "ZEE_PRIMARY", requires: { env: ["ZEE_ENV"] } },
      },
    })

    expect(result.primaryEnv).toBe("META_PRIMARY")
    expect(result.envVars).toEqual(["TOP_ENV", "META_ENV", "ZEE_ENV"])
  })

  test("parses metadata when provided as JSON string", () => {
    const result = extractAuthFromFrontmatter({
      requires: { env: ["TOP_ENV"] },
      metadata: JSON.stringify({ primaryEnv: "META_PRIMARY", requires: { env: ["META_ENV"] } }),
    })

    expect(result.primaryEnv).toBe("META_PRIMARY")
    expect(result.envVars).toEqual(["TOP_ENV", "META_ENV"])
  })

  test("ignores invalid metadata strings", () => {
    const result = extractAuthFromFrontmatter({
      requires: { env: ["TOP_ENV"] },
      metadata: "{invalid json",
    })

    expect(result.primaryEnv).toBeUndefined()
    expect(result.envVars).toEqual(["TOP_ENV"])
  })

  test("builds and normalizes local provider URLs", () => {
    expect(resolveLocalProviderBaseUrl("localhost", 8000)).toBe("http://localhost:8000/v1")
    expect(normalizeLocalProviderBaseUrl("localhost:8000", 8000)).toBe("http://localhost:8000/v1")
    expect(normalizeLocalProviderBaseUrl("http://127.0.0.1", 8000)).toBe("http://127.0.0.1:8000/v1")
    expect(normalizeLocalProviderBaseUrl("https://host.example/v1/", 8000)).toBe("https://host.example/v1")
  })

  test("parses model IDs from OpenAI-compatible /models payload", () => {
    expect(
      parseOpenAICompatibleModelIds({
        data: [{ id: "gpt-oss" }, { id: "gpt-oss" }, { id: "qwen3" }, { id: "" }, {}],
      }),
    ).toEqual(["gpt-oss", "qwen3"])
  })

  test("discovers models with optional bearer auth", async () => {
    const requests: Array<{ url: string; auth?: string }> = []
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const headers = init?.headers as Record<string, string> | undefined
      requests.push({ url, auth: headers?.Authorization })
      return new Response(JSON.stringify({ data: [{ id: "qwen3-coder" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const discovered = await discoverOpenAICompatibleModels({
      baseURL: "http://localhost:8000/v1",
      apiKey: "secret-key",
      fetchFn,
    })

    expect(discovered).toEqual(["qwen3-coder"])
    expect(requests[0]).toEqual({
      url: "http://localhost:8000/v1/models",
      auth: "Bearer secret-key",
    })
  })

  test("returns empty models when discovery fails", async () => {
    const fetchFn = (async () => {
      return new Response("boom", { status: 500 })
    }) as typeof fetch
    const discovered = await discoverOpenAICompatibleModels({
      baseURL: "http://localhost:8000/v1",
      fetchFn,
    })
    expect(discovered).toEqual([])
  })
})
