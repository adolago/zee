import { describe, expect, test } from "bun:test"
import { stackedTildeColumnFrame, stackedTildeFrame } from "../../../src/cli/cmd/tui/ui/tilde-spinner"

const COMBINING_TILDE_ABOVE = "\u0303"
const COMBINING_TILDE_BELOW = "\u0330"
const FRAME_HOLD_TICKS = 3

const expectedCenteredFrames = [
  "~",
  `~${COMBINING_TILDE_ABOVE}`,
  `~${COMBINING_TILDE_ABOVE}${COMBINING_TILDE_BELOW}`,
  `~${COMBINING_TILDE_BELOW}`,
]

const expectedHeldFrames = expectedCenteredFrames.flatMap((frame) => Array(FRAME_HOLD_TICKS).fill(frame))

describe("stackedTildeColumnFrame", () => {
  test("returns a single tilde when animation is disabled", () => {
    expect(stackedTildeColumnFrame(0, false)).toBe("~")
    expect(stackedTildeColumnFrame(999, false)).toBe("~")
  })

  test("cycles with centered top/bottom motion", () => {
    const actual = Array.from({ length: expectedHeldFrames.length }, (_, tick) => stackedTildeColumnFrame(tick))
    expect(actual).toEqual(expectedHeldFrames)
  })

  test("never emits multiline output", () => {
    for (let tick = 0; tick < 20; tick++) {
      expect(stackedTildeColumnFrame(tick)).not.toContain("\n")
    }
  })
})

describe("stackedTildeFrame", () => {
  test("returns a single tilde when animation is disabled", () => {
    expect(stackedTildeFrame(0, false)).toBe("~")
    expect(stackedTildeFrame(999, false)).toBe("~")
  })

  test("matches the centered top/bottom cycle", () => {
    const actual = Array.from({ length: expectedHeldFrames.length }, (_, tick) => stackedTildeFrame(tick))
    expect(actual).toEqual(expectedHeldFrames)
  })
})
