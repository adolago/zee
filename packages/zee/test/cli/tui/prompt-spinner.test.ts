import { describe, expect, test } from "bun:test"
import { promptSpinnerColumnFrame, promptSpinnerFrame } from "../../../src/cli/cmd/tui/ui/prompt-spinner"

const expectedStackedFrames = ["⠋⠙⠹", "⠙⠹⠸", "⠹⠸⠼", "⠸⠼⠴", "⠼⠴⠦", "⠴⠦⠧", "⠦⠧⠇", "⠧⠇⠏", "⠇⠏⠋", "⠏⠋⠙"]
const expectedColumnFrames = ["⠋⠙⠹", "⠙⠹⠸", "⠹⠸⠼", "⠸⠼⠴", "⠼⠴⠦", "⠴⠦⠧", "⠦⠧⠇", "⠧⠇⠏", "⠇⠏⠋", "⠏⠋⠙"]
const expectedTicksPerFrameInCycle = [3, 2, 3, 2, 2, 3, 2, 3, 2, 2]
const expectedCycleTicks = expectedTicksPerFrameInCycle.reduce((sum, ticks) => sum + ticks, 0)
const expectedSingleCycleStackedFrames = expectedStackedFrames.flatMap((frame, i) =>
  Array(expectedTicksPerFrameInCycle[i] ?? 0).fill(frame),
)
const expectedSingleCycleColumnFrames = expectedColumnFrames.flatMap((frame, i) =>
  Array(expectedTicksPerFrameInCycle[i] ?? 0).fill(frame),
)

describe("promptSpinnerColumnFrame", () => {
  test("returns a single tilde when animation is disabled", () => {
    expect(promptSpinnerColumnFrame(0, false)).toBe("~")
    expect(promptSpinnerColumnFrame(999, false)).toBe("~")
  })

  test("cycles through canonical 3-cell braille motion at 25% faster cadence", () => {
    const cycle = Array.from({ length: expectedCycleTicks }, (_, tick) => promptSpinnerColumnFrame(tick))
    expect(cycle).toEqual(expectedSingleCycleColumnFrames)
    const nextCycle = Array.from({ length: expectedCycleTicks }, (_, i) => promptSpinnerColumnFrame(i + expectedCycleTicks))
    expect(nextCycle).toEqual(expectedSingleCycleColumnFrames)
  })

  test("uses three terminal cells when animated", () => {
    for (let tick = 0; tick < 30; tick++) {
      expect(Bun.stringWidth(promptSpinnerColumnFrame(tick))).toBe(3)
    }
  })

  test("never emits multiline output", () => {
    for (let tick = 0; tick < 20; tick++) {
      expect(promptSpinnerColumnFrame(tick)).not.toContain("\n")
    }
  })
})

describe("promptSpinnerFrame", () => {
  test("returns a single tilde when animation is disabled", () => {
    expect(promptSpinnerFrame(0, false)).toBe("~")
    expect(promptSpinnerFrame(999, false)).toBe("~")
  })

  test("matches the canonical 3-cell braille cycle with faster cadence", () => {
    const cycle = Array.from({ length: expectedCycleTicks }, (_, tick) => promptSpinnerFrame(tick))
    expect(cycle).toEqual(expectedSingleCycleStackedFrames)
  })

  test("uses three terminal cells when animated", () => {
    for (let tick = 0; tick < 30; tick++) {
      expect(Bun.stringWidth(promptSpinnerFrame(tick))).toBe(3)
    }
  })
})
