import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Server } from "../../src/server/server"

describe("Proxy SSRF Security", () => {
  const originalEnv = process.env.AGENT_CORE_PROXY_BASE_URL

  beforeAll(() => {
    // Set a safe proxy base
    process.env.AGENT_CORE_PROXY_BASE_URL = "http://localhost:1234"
  })

  afterAll(() => {
    if (originalEnv) {
      process.env.AGENT_CORE_PROXY_BASE_URL = originalEnv
    } else {
      delete process.env.AGENT_CORE_PROXY_BASE_URL
    }
  })

  test("should block access to different origin via SSRF", async () => {
    const app = Server.App()

    // Request with double slash which can be interpreted as protocol-relative URL
    // resulting in SSRF if unchecked.
    const req = new Request("http://localhost//evil.com", {
      method: "GET",
    })

    const res = await app.fetch(req)

    // We expect 403 Forbidden if the security fix is in place.
    // If vulnerable, it might return 500 (connection error), 404 (upstream not found), or 200 (if it actually hit something).
    // The key is that we want to enforce 403.
    expect(res.status).toBe(403)
  })

  test("should allow access to valid paths", async () => {
     const app = Server.App()
     // Valid path that should be proxied (and fail with connection error because localhost:1234 is likely closed)
     // but NOT 403.
     const req = new Request("http://localhost/foo", {
        method: "GET"
     })

     const res = await app.fetch(req)
     // 502 Bad Gateway or 500 Internal Server Error is expected if proxy fails to connect.
     // 404 Not Found might be returned if proxyBase is invalid.
     // But definitely NOT 403.
     expect(res.status).not.toBe(403)
  })
})
