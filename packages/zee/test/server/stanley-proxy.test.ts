import { afterAll, beforeAll, describe, expect, test } from "bun:test"

const ORIGINAL_ENV = {
  STANLEY_API_URL: process.env.STANLEY_API_URL,
}

let upstream: ReturnType<typeof Bun.serve> | null = null
let seenUrl = ""

beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    fetch(req) {
      seenUrl = req.url
      return Response.json({ ok: true, url: req.url })
    },
  })
  process.env.STANLEY_API_URL = `http://127.0.0.1:${upstream.port}`
})

afterAll(() => {
  upstream?.stop()
  if (ORIGINAL_ENV.STANLEY_API_URL === undefined) delete process.env.STANLEY_API_URL
  else process.env.STANLEY_API_URL = ORIGINAL_ENV.STANLEY_API_URL
})

const { StanleyProxyRoute } = await import("../../src/server/route/stanley-proxy")

describe("StanleyProxyRoute", () => {
  test("preserves query parameters when proxying", async () => {
    const response = await StanleyProxyRoute.request("/valuation/AAPL?include_dcf=true&view=full", {
      method: "GET",
    })

    expect(response.status).toBe(200)
    expect(seenUrl).toContain("/valuation/AAPL?include_dcf=true&view=full")
  })
})
