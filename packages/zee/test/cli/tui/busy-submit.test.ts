import { describe, expect, test } from "bun:test"
import { classifySteerSubmitError, decideBusySubmit } from "../../../src/cli/cmd/tui/component/prompt/busy-submit"

describe("tui busy submit behavior", () => {
  test("when idle, always submits normally", () => {
    expect(
      decideBusySubmit({ sessionIsBusy: false, hasSessionID: true, hasActiveTurn: true, trigger: "enter" }),
    ).toEqual({
      submit: "prompt",
    })
    expect(decideBusySubmit({ sessionIsBusy: false, hasSessionID: true, hasActiveTurn: true, trigger: "tab" })).toEqual(
      {
        submit: "prompt",
      },
    )
    expect(
      decideBusySubmit({ sessionIsBusy: false, hasSessionID: false, hasActiveTurn: false, trigger: "enter" }),
    ).toEqual({
      submit: "prompt",
    })
  })

  test("when busy and there is no sessionID, submits normally (new session flow)", () => {
    expect(
      decideBusySubmit({ sessionIsBusy: true, hasSessionID: false, hasActiveTurn: false, trigger: "enter" }),
    ).toEqual({
      submit: "prompt",
    })
    expect(
      decideBusySubmit({ sessionIsBusy: true, hasSessionID: false, hasActiveTurn: false, trigger: "tab" }),
    ).toEqual({
      submit: "prompt",
    })
  })

  test("when busy with active session but no steerable turn, Enter queues", () => {
    expect(
      decideBusySubmit({ sessionIsBusy: true, hasSessionID: true, hasActiveTurn: false, trigger: "enter" }),
    ).toEqual({
      submit: "queue",
    })
  })

  test("when busy with active session, Enter steers", () => {
    expect(
      decideBusySubmit({ sessionIsBusy: true, hasSessionID: true, hasActiveTurn: true, trigger: "enter" }),
    ).toEqual({
      submit: "steer",
    })
  })

  test("when busy with active session, Tab queues", () => {
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: true, hasActiveTurn: true, trigger: "tab" })).toEqual({
      submit: "queue",
    })
  })
})

describe("classifySteerSubmitError", () => {
  test("classifies no-active-turn steer race", () => {
    expect(classifySteerSubmitError({ error: "No active turn to steer." })).toBe("steer_race_no_active_turn")
    expect(classifySteerSubmitError("No active turn to steer.")).toBe("steer_race_no_active_turn")
  })

  test("classifies expected-turn mismatch steer race", () => {
    expect(
      classifySteerSubmitError({
        error: "Steer rejected: expectedTurnID does not match the active turn.",
        activeTurnID: "turn_2",
      }),
    ).toBe("steer_race_expected_turn_mismatch")
    expect(
      classifySteerSubmitError(new Error("Steer rejected: expectedTurnID does not match the active turn.")),
    ).toBe("steer_race_expected_turn_mismatch")
  })

  test("classifies unrelated errors as other", () => {
    expect(classifySteerSubmitError({ error: "Unauthorized" })).toBe("other")
    expect(classifySteerSubmitError("network timeout")).toBe("other")
  })
})
