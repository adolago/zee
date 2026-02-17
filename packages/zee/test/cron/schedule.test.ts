import { describe, expect, test } from "bun:test"

import { computeNextRunAtMs } from "../../src/cron/schedule"

describe("cron schedule", () => {
  test("computes next run for cron expression with timezone", () => {
    // Saturday, Dec 13 2025 00:00:00Z
    const nowMs = Date.parse("2025-12-13T00:00:00.000Z")
    const next = computeNextRunAtMs({ kind: "cron", expr: "0 9 * * 3", tz: "America/Los_Angeles" }, nowMs)
    // Next Wednesday at 09:00 PST -> 17:00Z
    expect(next).toBe(Date.parse("2025-12-17T17:00:00.000Z"))
  })

  test("computes next run for every schedule", () => {
    const anchor = Date.parse("2025-12-13T00:00:00.000Z")
    const now = anchor + 10_000
    const next = computeNextRunAtMs({ kind: "every", everyMs: 30_000, anchorMs: anchor }, now)
    expect(next).toBe(anchor + 30_000)
  })

  test("computes next run for every schedule when anchorMs is not provided", () => {
    const now = Date.parse("2025-12-13T00:00:00.000Z")
    const next = computeNextRunAtMs({ kind: "every", everyMs: 30_000 }, now)
    expect(next).toBe(now + 30_000)
  })

  test("returns undefined for invalid cron schedules instead of throwing", () => {
    const now = Date.parse("2025-12-13T00:00:00.000Z")

    expect(() => computeNextRunAtMs({ kind: "cron" } as any, now)).not.toThrow()
    expect(computeNextRunAtMs({ kind: "cron" } as any, now)).toBeUndefined()

    expect(() => computeNextRunAtMs({ kind: "cron", expr: 123 } as any, now)).not.toThrow()
    expect(computeNextRunAtMs({ kind: "cron", expr: 123 } as any, now)).toBeUndefined()

    expect(() => computeNextRunAtMs({ kind: "cron", expr: "not a cron" } as any, now)).not.toThrow()
    expect(computeNextRunAtMs({ kind: "cron", expr: "not a cron" } as any, now)).toBeUndefined()
  })

  test("returns undefined for unknown schedule kinds instead of throwing", () => {
    const now = Date.parse("2025-12-13T00:00:00.000Z")
    expect(() => computeNextRunAtMs({ kind: "wat" } as any, now)).not.toThrow()
    expect(computeNextRunAtMs({ kind: "wat" } as any, now)).toBeUndefined()
  })
})
