import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createAuthorizedFetch, getAuthorizationHeader } from "../../src/server/auth"
import { reloadFlags } from "../../src/flag/flag"

const ORIGINAL_ENV = {
  ZEE_ENABLE_SERVER_AUTH: process.env.ZEE_ENABLE_SERVER_AUTH,
  ZEE_DISABLE_SERVER_AUTH: process.env.ZEE_DISABLE_SERVER_AUTH,
  ZEE_SERVER_USERNAME: process.env.ZEE_SERVER_USERNAME,
  ZEE_SERVER_PASSWORD: process.env.ZEE_SERVER_PASSWORD,
}

beforeAll(() => {
  process.env.ZEE_ENABLE_SERVER_AUTH = "1"
  delete process.env.ZEE_DISABLE_SERVER_AUTH
  delete process.env.ZEE_SERVER_USERNAME
  process.env.ZEE_SERVER_PASSWORD = "test-password"
  reloadFlags()
})

afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
})

describe("createAuthorizedFetch", () => {
  test("adds Authorization header when server auth is enabled", async () => {
    const auth = getAuthorizationHeader()
    expect(auth).toBeDefined()

    let seen: string | undefined
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request && !init ? input : new Request(input, init)
      seen = req.headers.get("Authorization") ?? undefined
      return new Response("ok", { status: 200 })
    }) as any as typeof fetch

    const authorizedFetch = createAuthorizedFetch(fakeFetch)
    const res = await authorizedFetch("http://example.invalid/test", { method: "GET" })
    expect(res.status).toBe(200)
    expect(seen).toBe(auth)
  })

  test("does not override an existing Authorization header", async () => {
    let seen: string | undefined
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request && !init ? input : new Request(input, init)
      seen = req.headers.get("Authorization") ?? undefined
      return new Response("ok", { status: 200 })
    }) as any as typeof fetch

    const authorizedFetch = createAuthorizedFetch(fakeFetch)
    await authorizedFetch("http://example.invalid/test", {
      method: "GET",
      headers: {
        Authorization: "Basic Zm9vOmJhcg==",
      },
    })
    expect(seen).toBe("Basic Zm9vOmJhcg==")
  })
})
