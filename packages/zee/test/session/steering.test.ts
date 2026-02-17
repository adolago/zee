import { describe, expect, test } from "bun:test"
import { SessionSteering } from "../../src/session/steering"

describe("SessionSteering", () => {
  test("mark and check", () => {
    const id = "session_test_mark"
    const turnID = "turn_test_mark"
    expect(SessionSteering.check(id, turnID)).toBe(false)
    SessionSteering.mark(id, turnID)
    expect(SessionSteering.check(id, turnID)).toBe(true)
    // cleanup
    SessionSteering.clear(id)
  })

  test("clear removes the flag", () => {
    const id = "session_test_clear"
    const turnID = "turn_test_clear"
    SessionSteering.mark(id, turnID)
    expect(SessionSteering.check(id, turnID)).toBe(true)
    SessionSteering.clear(id)
    expect(SessionSteering.check(id, turnID)).toBe(false)
  })

  test("clear is idempotent", () => {
    const id = "session_test_idempotent"
    const turnID = "turn_test_idempotent"
    SessionSteering.clear(id)
    SessionSteering.clear(id)
    expect(SessionSteering.check(id, turnID)).toBe(false)
  })

  test("independent sessions do not interfere", () => {
    const a = "session_test_a"
    const b = "session_test_b"
    const turnA = "turn_test_a"
    const turnB = "turn_test_b"
    SessionSteering.mark(a, turnA)
    expect(SessionSteering.check(a, turnA)).toBe(true)
    expect(SessionSteering.check(b, turnB)).toBe(false)
    SessionSteering.clear(a)
  })

  test("does not match stale turn ids", () => {
    const session = "session_test_stale"
    SessionSteering.mark(session, "turn_old")
    expect(SessionSteering.check(session, "turn_new")).toBe(false)
    expect(SessionSteering.check(session, "turn_old")).toBe(true)
    SessionSteering.clear(session, "turn_new")
    expect(SessionSteering.check(session, "turn_old")).toBe(true)
    SessionSteering.clear(session, "turn_old")
    expect(SessionSteering.check(session, "turn_old")).toBe(false)
  })
})
