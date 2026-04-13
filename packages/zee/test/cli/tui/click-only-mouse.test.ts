import { expect, test } from "bun:test"
import type { MouseEvent } from "@opentui/core"
import { createClickOnlyMouseHandlers } from "../../../src/cli/cmd/tui/util/click-only-mouse"

function mouseEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    type: "down",
    button: 0,
    defaultPrevented: false,
    isSelecting: false,
    ...overrides,
  } as MouseEvent
}

test("creates no hover or move handlers", () => {
  const handlers = createClickOnlyMouseHandlers({
    onPress() {},
    onRelease() {},
  }) as Record<string, unknown>

  expect(Object.keys(handlers).sort()).toEqual(["onMouseDown", "onMouseUp"])
  expect(handlers.onMouseMove).toBeUndefined()
  expect(handlers.onMouseOver).toBeUndefined()
  expect(handlers.onMouseOut).toBeUndefined()
})

test("runs press handler on mouse down only", () => {
  const calls: string[] = []
  const handlers = createClickOnlyMouseHandlers({
    onPress: () => calls.push("press"),
  })

  handlers.onMouseDown?.(mouseEvent({ type: "down" }))
  handlers.onMouseUp?.(mouseEvent({ type: "up" }))

  expect(calls).toEqual(["press"])
})

test("runs release handler only after a valid primary-button press", () => {
  const calls: string[] = []
  const handlers = createClickOnlyMouseHandlers({
    onRelease: () => calls.push("release"),
  })

  handlers.onMouseUp?.(mouseEvent({ type: "up" }))
  handlers.onMouseDown?.(mouseEvent({ type: "down" }))
  handlers.onMouseUp?.(mouseEvent({ type: "up" }))

  expect(calls).toEqual(["release"])
})

test("supports combined selection on press and activation on release", () => {
  const calls: string[] = []
  const handlers = createClickOnlyMouseHandlers({
    onPress: () => calls.push("move"),
    onRelease: () => calls.push("activate"),
  })

  handlers.onMouseDown?.(mouseEvent({ type: "down" }))
  handlers.onMouseUp?.(mouseEvent({ type: "up" }))

  expect(calls).toEqual(["move", "activate"])
})

test("ignores non-primary buttons and selection gestures", () => {
  const calls: string[] = []
  const handlers = createClickOnlyMouseHandlers({
    onPress: () => calls.push("press"),
    onRelease: () => calls.push("release"),
  })

  handlers.onMouseDown?.(mouseEvent({ type: "down", button: 1 }))
  handlers.onMouseUp?.(mouseEvent({ type: "up", button: 1 }))
  handlers.onMouseDown?.(mouseEvent({ type: "down", isSelecting: true }))
  handlers.onMouseUp?.(mouseEvent({ type: "up", isSelecting: true }))

  expect(calls).toEqual([])
})

test("ignores move and drag events even when wired into click-only handlers", () => {
  const calls: string[] = []
  const handlers = createClickOnlyMouseHandlers({
    onPress: () => calls.push("press"),
    onRelease: () => calls.push("release"),
  })

  handlers.onMouseDown?.(mouseEvent({ type: "move" }))
  handlers.onMouseDown?.(mouseEvent({ type: "drag" }))
  handlers.onMouseUp?.(mouseEvent({ type: "drag-end" }))
  handlers.onMouseUp?.(mouseEvent({ type: "scroll" }))

  expect(calls).toEqual([])
})
