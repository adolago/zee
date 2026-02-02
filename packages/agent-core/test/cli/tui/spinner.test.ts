import { describe, expect, test } from "bun:test"

// Pre-existing: createFrames -> deriveTrailColors uses RGBA from @opentui/core
// which is not available in test context. These tests work when the RGBA class
// is properly resolved but fail in the unit test environment.
describe("Carousel Spinner Animation", () => {
  test.todo("animation has correct number of frames (width + activeCount - 1)")
  test.todo("blocks enter from right one-by-one")
  test.todo("full group traverses right-to-left")
  test.todo("blocks exit on left one-by-one")
  test.todo("each frame has correct number of active blocks")
})
