import { afterEach, describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { createAuthRateLimiter } from "../../src/server/auth-rate-limit"
import { Server } from "../../src/server/server"

function basicAuth(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf-8").toString("base64")
  return `Basic ${token}`
}

const ORIGINAL_ENV = {
  ZEE_ENABLE_SERVER_AUTH: process.env.ZEE_ENABLE_SERVER_AUTH,
  ZEE_DISABLE_SERVER_AUTH: process.env.ZEE_DISABLE_SERVER_AUTH,
  ZEE_SERVER_USERNAME: process.env.ZEE_SERVER_USERNAME,
  ZEE_SERVER_PASSWORD: process.env.ZEE_SERVER_PASSWORD,
  ZEE_SERVER_SCOPES: process.env.ZEE_SERVER_SCOPES,
  ZEE_SERVER_AUTH_RATE_LIMIT: process.env.ZEE_SERVER_AUTH_RATE_LIMIT,
  ZEE_SERVER_AUTH_RATE_LIMIT_MAX_ATTEMPTS: process.env.ZEE_SERVER_AUTH_RATE_LIMIT_MAX_ATTEMPTS,
  ZEE_SERVER_AUTH_RATE_LIMIT_WINDOW_MS: process.env.ZEE_SERVER_AUTH_RATE_LIMIT_WINDOW_MS,
  ZEE_SERVER_AUTH_RATE_LIMIT_LOCKOUT_MS: process.env.ZEE_SERVER_AUTH_RATE_LIMIT_LOCKOUT_MS,
  ZEE_SERVER_AUTH_RATE_LIMIT_EXEMPT_LOOPBACK: process.env.ZEE_SERVER_AUTH_RATE_LIMIT_EXEMPT_LOOPBACK,
}

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
  Server.reset()
})

describe("server auth rate limiter", () => {
  test("blocks requests after max failed attempts", () => {
    const limiter = createAuthRateLimiter({
      maxAttempts: 2,
      windowMs: 60_000,
      lockoutMs: 30_000,
      exemptLoopback: false,
    })

    try {
      limiter.recordFailure("10.0.0.1")
      limiter.recordFailure("10.0.0.1")
      const result = limiter.check("10.0.0.1")
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfterMs).toBeGreaterThan(0)
    } finally {
      limiter.dispose()
    }
  })

  test("exempts loopback addresses by default", () => {
    const limiter = createAuthRateLimiter({ maxAttempts: 1 })

    try {
      limiter.recordFailure("127.0.0.1")
      const result = limiter.check("127.0.0.1")
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(1)
    } finally {
      limiter.dispose()
    }
  })

  test("returns 429 after repeated failed auth attempts", async () => {
    process.env.ZEE_ENABLE_SERVER_AUTH = "1"
    delete process.env.ZEE_DISABLE_SERVER_AUTH
    process.env.ZEE_SERVER_PASSWORD = "test-password"
    delete process.env.ZEE_SERVER_SCOPES

    process.env.ZEE_SERVER_AUTH_RATE_LIMIT = "1"
    process.env.ZEE_SERVER_AUTH_RATE_LIMIT_MAX_ATTEMPTS = "2"
    process.env.ZEE_SERVER_AUTH_RATE_LIMIT_WINDOW_MS = "60000"
    process.env.ZEE_SERVER_AUTH_RATE_LIMIT_LOCKOUT_MS = "60000"
    process.env.ZEE_SERVER_AUTH_RATE_LIMIT_EXEMPT_LOOPBACK = "0"

    reloadFlags()
    Server.reset()

    const app = Server.App()

    const first = await app.request("/global/health", { method: "GET" })
    expect(first.status).toBe(401)

    const second = await app.request("/global/health", { method: "GET" })
    expect(second.status).toBe(401)

    const third = await app.request("/global/health", { method: "GET" })
    expect(third.status).toBe(429)
    expect(third.headers.get("Retry-After")).toBeTruthy()
  })

  test("successful auth resets failure counter", async () => {
    process.env.ZEE_ENABLE_SERVER_AUTH = "1"
    delete process.env.ZEE_DISABLE_SERVER_AUTH
    process.env.ZEE_SERVER_PASSWORD = "test-password"
    delete process.env.ZEE_SERVER_SCOPES

    process.env.ZEE_SERVER_AUTH_RATE_LIMIT = "1"
    process.env.ZEE_SERVER_AUTH_RATE_LIMIT_MAX_ATTEMPTS = "2"
    process.env.ZEE_SERVER_AUTH_RATE_LIMIT_WINDOW_MS = "60000"
    process.env.ZEE_SERVER_AUTH_RATE_LIMIT_LOCKOUT_MS = "60000"
    process.env.ZEE_SERVER_AUTH_RATE_LIMIT_EXEMPT_LOOPBACK = "0"

    reloadFlags()
    Server.reset()

    const app = Server.App()

    const failBefore = await app.request("/global/health", { method: "GET" })
    expect(failBefore.status).toBe(401)

    const success = await app.request("/global/health", {
      method: "GET",
      headers: {
        Authorization: basicAuth("zee", "test-password"),
      },
    })
    expect(success.status).toBe(200)

    const failAfter = await app.request("/global/health", { method: "GET" })
    expect(failAfter.status).toBe(401)
  })
})
