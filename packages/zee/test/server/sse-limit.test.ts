import { afterEach, describe, expect, test } from "bun:test"
import { reloadFlags } from "../../src/flag/flag"
import { RequestMeta } from "../../src/server/request-meta"
import { SseLimit } from "../../src/server/sse-limit"

const ORIGINAL_ENV = {
  ZEE_SERVER_MAX_SSE_CONNECTIONS: process.env.ZEE_SERVER_MAX_SSE_CONNECTIONS,
  ZEE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT: process.env.ZEE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT,
}

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  reloadFlags()
  SseLimit.resetForTests()
})

describe("SseLimit", () => {
  test("enforces per-client and total SSE connection caps", () => {
    process.env.ZEE_SERVER_MAX_SSE_CONNECTIONS = "2"
    process.env.ZEE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT = "1"
    reloadFlags()

    const reqA1 = new Request("http://localhost/app/event")
    RequestMeta.setIp(reqA1, "127.0.0.1")
    const slotA1 = SseLimit.acquire(reqA1)
    expect(slotA1.ok).toBe(true)

    const reqA2 = new Request("http://localhost/app/event")
    RequestMeta.setIp(reqA2, "127.0.0.1")
    const slotA2 = SseLimit.acquire(reqA2)
    expect(slotA2.ok).toBe(false)

    const reqB1 = new Request("http://localhost/app/event")
    RequestMeta.setIp(reqB1, "10.0.0.2")
    const slotB1 = SseLimit.acquire(reqB1)
    expect(slotB1.ok).toBe(true)

    const reqC1 = new Request("http://localhost/app/event")
    RequestMeta.setIp(reqC1, "10.0.0.3")
    const slotC1 = SseLimit.acquire(reqC1)
    expect(slotC1.ok).toBe(false)

    // Clean up
    if (slotA1.ok) slotA1.release()
    if (slotB1.ok) slotB1.release()
  })

  test("releasing a slot decrements counts and allows reconnect", () => {
    process.env.ZEE_SERVER_MAX_SSE_CONNECTIONS = "1"
    process.env.ZEE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT = "1"
    reloadFlags()

    const reqA1 = new Request("http://localhost/app/event")
    RequestMeta.setIp(reqA1, "127.0.0.1")
    const slotA1 = SseLimit.acquire(reqA1)
    expect(slotA1.ok).toBe(true)

    const reqB1 = new Request("http://localhost/app/event")
    RequestMeta.setIp(reqB1, "10.0.0.2")
    const slotB1 = SseLimit.acquire(reqB1)
    expect(slotB1.ok).toBe(false)

    if (slotA1.ok) slotA1.release()

    const reqB2 = new Request("http://localhost/app/event")
    RequestMeta.setIp(reqB2, "10.0.0.2")
    const slotB2 = SseLimit.acquire(reqB2)
    expect(slotB2.ok).toBe(true)

    if (slotB2.ok) slotB2.release()
  })
})

