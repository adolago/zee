import { describe, expect, test } from "bun:test"
import { decideBusySubmit } from "../../../src/cli/cmd/tui/component/prompt/busy-submit"

describe("tui busy submit behavior", () => {
  test("when idle, always submits normally", () => {
    expect(
      decideBusySubmit({ sessionIsBusy: false, hasSessionID: true, behavior: "followup" }),
    ).toEqual({ submit: "prompt", shouldAbort: false })

    expect(decideBusySubmit({ sessionIsBusy: false, hasSessionID: true, behavior: "steer" })).toEqual({
      submit: "prompt",
      shouldAbort: false,
    })
  })

  test("when busy and there is no sessionID, submits normally (new session flow)", () => {
    expect(
      decideBusySubmit({ sessionIsBusy: true, hasSessionID: false, behavior: "followup" }),
    ).toEqual({ submit: "prompt", shouldAbort: false })
  })

  test("followup queues the message", () => {
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: true, behavior: "followup" })).toEqual({
      submit: "promptAsync",
      shouldAbort: false,
    })
  })

  test("steer interrupts then submits normally", () => {
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: true, behavior: "steer" })).toEqual({
      submit: "prompt",
      shouldAbort: true,
    })
  })

  test("reject refuses to submit", () => {
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: true, behavior: "reject" })).toEqual({
      submit: "reject",
      shouldAbort: false,
    })
  })
})

