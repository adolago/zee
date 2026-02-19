import { describe, expect, test } from "bun:test"
import { SessionProcessor } from "../../src/session/processor"

describe("SessionProcessor.mergeStreamText", () => {
  test("appends plain delta chunks", () => {
    expect(SessionProcessor.mergeStreamText("Hello", " world")).toBe("Hello world")
  })

  test("accepts cumulative snapshots without duplicating streamed text", () => {
    expect(SessionProcessor.mergeStreamText("Hello", "Hello world")).toBe("Hello world")
  })

  test("preserves streamed text when a later payload regresses", () => {
    expect(SessionProcessor.mergeStreamText("Hello world from stream", "Hello world")).toBe("Hello world from stream")
  })

  test("stitches overlapping chunks", () => {
    expect(SessionProcessor.mergeStreamText("Hello", "lo world")).toBe("Hello world")
  })
})
