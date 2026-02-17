import { describe, expect, test } from "bun:test"
import { decideBusySubmit } from "../../../src/cli/cmd/tui/component/prompt/busy-submit"

describe("tui busy submit behavior", () => {
  test("when idle, always submits normally", () => {
    expect(decideBusySubmit({ sessionIsBusy: false, hasSessionID: true, hasActiveTurn: true, trigger: "enter" })).toEqual({
      submit: "prompt",
    })
    expect(decideBusySubmit({ sessionIsBusy: false, hasSessionID: true, hasActiveTurn: true, trigger: "tab" })).toEqual({
      submit: "prompt",
    })
    expect(decideBusySubmit({ sessionIsBusy: false, hasSessionID: false, hasActiveTurn: false, trigger: "enter" })).toEqual({
      submit: "prompt",
    })
  })

  test("when busy and there is no sessionID, submits normally (new session flow)", () => {
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: false, hasActiveTurn: false, trigger: "enter" })).toEqual({
      submit: "prompt",
    })
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: false, hasActiveTurn: false, trigger: "tab" })).toEqual({
      submit: "prompt",
    })
  })

  test("when busy with active session but no steerable turn, Enter queues", () => {
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: true, hasActiveTurn: false, trigger: "enter" })).toEqual({
      submit: "queue",
    })
  })

  test("when busy with active session, Enter steers", () => {
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: true, hasActiveTurn: true, trigger: "enter" })).toEqual({
      submit: "steer",
    })
  })

  test("when busy with active session, Tab queues", () => {
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: true, hasActiveTurn: true, trigger: "tab" })).toEqual({
      submit: "queue",
    })
  })
})
