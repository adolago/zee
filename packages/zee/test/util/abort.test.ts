import { describe, expect, test } from "bun:test"
import { abortAfter, abortAfterAny } from "../../src/util/abort"

describe("util.abort", () => {
  test("abortAfter aborts after timeout", async () => {
    const timeout = abortAfter(15)
    expect(timeout.signal.aborted).toBe(false)
    await Bun.sleep(40)
    expect(timeout.signal.aborted).toBe(true)
    timeout.clearTimeout()
  })

  test("abortAfterAny aborts when an input signal aborts", async () => {
    const upstream = new AbortController()
    const combined = abortAfterAny(1000, upstream.signal)
    expect(combined.signal.aborted).toBe(false)
    upstream.abort()
    await Bun.sleep(0)
    expect(combined.signal.aborted).toBe(true)
    combined.clearTimeout()
  })

  test("abortAfterAny can clear timeout before abort", async () => {
    const combined = abortAfterAny(20)
    combined.clearTimeout()
    await Bun.sleep(50)
    expect(combined.signal.aborted).toBe(false)
  })
})
