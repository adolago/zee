import { describe, expect, test } from "bun:test"

let createFrames: typeof import("@tui/ui/spinner").createFrames | undefined
let available = false

try {
  const mod = await import("@tui/ui/spinner")
  createFrames = mod.createFrames
  available = true
} catch {
  // RGBA from @opentui/core not available in test context
}

describe.skipIf(!available)("Carousel Spinner Animation", () => {
  const width = 10
  const activeCount = 4
  const opts = { animation: "carousel" as const, width, carouselActiveCount: activeCount, style: "blocks" as const }

  test("animation has correct number of frames (width + activeCount - 1)", () => {
    const frames = createFrames!(opts)
    expect(frames.length).toBe(width + activeCount - 1)
  })

  test("blocks enter from right one-by-one", () => {
    const frames = createFrames!(opts)
    // First frame: only 1 active block, at rightmost position
    const activeChar = "■"
    const firstFrame = frames[0]
    const activePositions = [...firstFrame].filter((c) => c === activeChar)
    expect(activePositions.length).toBe(1)
    // The active block should be at the right edge
    expect(firstFrame[firstFrame.length - 1]).toBe(activeChar)
  })

  test("full group traverses right-to-left", () => {
    const frames = createFrames!(opts)
    const activeChar = "■"
    // After activeCount-1 frames of entry, the full group is visible
    // Check that the group moves left over subsequent frames
    const fullGroupStart = activeCount - 1
    const prevPositions = getActivePositions(frames[fullGroupStart], activeChar)
    const nextPositions = getActivePositions(frames[fullGroupStart + 1], activeChar)
    // Group should shift left (positions decrease)
    expect(Math.min(...nextPositions)).toBeLessThan(Math.min(...prevPositions))
  })

  test("blocks exit on left one-by-one", () => {
    const frames = createFrames!(opts)
    const activeChar = "■"
    // Last frame: only 1 active block, at leftmost position
    const lastFrame = frames[frames.length - 1]
    const activePositions = [...lastFrame].filter((c) => c === activeChar)
    expect(activePositions.length).toBe(1)
    expect(lastFrame[0]).toBe(activeChar)
  })

  test("each frame has correct number of active blocks", () => {
    const frames = createFrames!(opts)
    const activeChar = "■"
    for (let i = 0; i < frames.length; i++) {
      const count = [...frames[i]].filter((c) => c === activeChar).length
      // During entry/exit phases, count grows/shrinks from 1 to activeCount
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBeLessThanOrEqual(activeCount)
    }
  })
})

function getActivePositions(frame: string, activeChar: string): number[] {
  return [...frame].reduce<number[]>((acc, c, i) => {
    if (c === activeChar) acc.push(i)
    return acc
  }, [])
}
