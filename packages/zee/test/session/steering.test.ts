import { describe, expect, test } from "bun:test"
import { SessionSteering } from "../../src/session/steering"

describe("SessionSteering", () => {
  test("mark and check", () => {
    const id = "session_test_mark"
    expect(SessionSteering.check(id)).toBe(false)
    SessionSteering.mark(id)
    expect(SessionSteering.check(id)).toBe(true)
    // cleanup
    SessionSteering.clear(id)
  })

  test("clear removes the flag", () => {
    const id = "session_test_clear"
    SessionSteering.mark(id)
    expect(SessionSteering.check(id)).toBe(true)
    SessionSteering.clear(id)
    expect(SessionSteering.check(id)).toBe(false)
  })

  test("clear is idempotent", () => {
    const id = "session_test_idempotent"
    SessionSteering.clear(id)
    SessionSteering.clear(id)
    expect(SessionSteering.check(id)).toBe(false)
  })

  test("independent sessions do not interfere", () => {
    const a = "session_test_a"
    const b = "session_test_b"
    SessionSteering.mark(a)
    expect(SessionSteering.check(a)).toBe(true)
    expect(SessionSteering.check(b)).toBe(false)
    SessionSteering.clear(a)
  })
})
