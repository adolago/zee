import { describe, expect, test } from "bun:test"
import { decideBusySubmit } from "../../../src/cli/cmd/tui/component/prompt/busy-submit"

describe("tui busy submit behavior", () => {
  test("when idle, always submits normally", () => {
    expect(decideBusySubmit({ sessionIsBusy: false, hasSessionID: true })).toEqual({ submit: "prompt" })
    expect(decideBusySubmit({ sessionIsBusy: false, hasSessionID: false })).toEqual({ submit: "prompt" })
  })

  test("when busy and there is no sessionID, submits normally (new session flow)", () => {
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: false })).toEqual({ submit: "prompt" })
  })

  test("when busy with active session, steers", () => {
    expect(decideBusySubmit({ sessionIsBusy: true, hasSessionID: true })).toEqual({ submit: "steer" })
  })
})
