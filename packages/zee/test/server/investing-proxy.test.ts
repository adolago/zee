import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"

function detectBunServeSupport() {
  try {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok")
      },
    })
    server.stop()
    return true
  } catch {
    return false
  }
}

const ORIGINAL_ENV = {
  ZEE_INVESTING_API_URL: process.env.ZEE_INVESTING_API_URL,
}

let upstream: ReturnType<typeof Bun.serve> | null = null
let seenUrl = ""
let InvestingProxyRoute: (typeof import("../../src/server/route/investing-proxy"))["InvestingProxyRoute"]
const bunServeSupported = detectBunServeSupport()

describe.skipIf(!bunServeSupported)("InvestingProxyRoute", () => {
  beforeAll(() => {
    mock.restore()
    upstream = Bun.serve({
      port: 0,
      fetch(req) {
        seenUrl = req.url
        return Response.json({ ok: true, url: req.url })
      },
    })
    process.env.ZEE_INVESTING_API_URL = `http://127.0.0.1:${upstream.port}`
  })

  beforeAll(async () => {
    mock.module("../../src/paths", () => ({
      Investing: {
        apiUrl: () => process.env.ZEE_INVESTING_API_URL || "http://127.0.0.1:8000",
      },
    }))
    ;({ InvestingProxyRoute } = await import("../../src/server/route/investing-proxy"))
  })

  afterAll(() => {
    upstream?.stop()
    if (ORIGINAL_ENV.ZEE_INVESTING_API_URL === undefined) delete process.env.ZEE_INVESTING_API_URL
    else process.env.ZEE_INVESTING_API_URL = ORIGINAL_ENV.ZEE_INVESTING_API_URL
  })

  test("preserves query parameters when proxying", async () => {
    const response = await InvestingProxyRoute.request("/valuation/AAPL?include_dcf=true&view=full", {
      method: "GET",
    })

    expect(response.status).toBe(200)
    expect(seenUrl).toContain("/valuation/AAPL?include_dcf=true&view=full")
  })
})
