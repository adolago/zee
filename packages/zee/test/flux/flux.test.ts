import { describe, expect, test } from "bun:test"
import { redactHeaders, redactValue, FluxStore } from "../../src/flux"
import type { FluxEvent } from "../../src/flux"

describe("flux redaction", () => {
  test("redacts sensitive headers in strict mode", () => {
    const result = redactHeaders(
      {
        Authorization: "Bearer secret-token",
        "X-Test": "value",
      },
      "strict",
    )
    expect(result.Authorization).toContain("[REDACTED]")
    expect(result["X-Test"]).toBe("value")
  })

  test("redacts sensitive object keys recursively", () => {
    const input = {
      token: "abc",
      nested: {
        api_key: "123",
        safe: "value",
      },
    }
    const output = redactValue(input, "strict") as Record<string, unknown>
    expect(String(output.token)).toContain("[REDACTED]")
    const nested = output.nested as Record<string, unknown>
    expect(String(nested.api_key)).toContain("[REDACTED]")
    expect(nested.safe).toBe("value")
  })
})

describe("flux store", () => {
  test("enforces global and per-trace limits", () => {
    const store = new FluxStore({
      enabled: true,
      retentionMs: 24 * 60 * 60 * 1000,
      maxEvents: 3,
      maxEventsPerTrace: 2,
      redaction: "strict",
      logMirror: false,
    })

    const base: Omit<FluxEvent, "id" | "timestamp"> = {
      traceID: "t1",
      direction: "internal",
      domain: "server",
      kind: "event",
      status: "ok",
    }

    const mk = (id: string, traceID: string, timestamp: number): FluxEvent => ({
      ...base,
      id,
      traceID,
      timestamp,
    })

    const now = Date.now()
    store.add(mk("1", "t1", now))
    store.add(mk("2", "t1", now + 1))
    store.add(mk("3", "t1", now + 2))
    store.add(mk("4", "t2", now + 3))

    const events = store.list({ limit: 10, offset: 0 })
    expect(events.length).toBe(3)
    expect(events.filter((event) => event.traceID === "t1").length).toBe(2)
  })
})
