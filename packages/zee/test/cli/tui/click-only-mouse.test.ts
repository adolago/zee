import { expect, test } from "bun:test"
import { createClickOnlyMouseHandlers } from "../../../src/cli/cmd/tui/util/click-only-mouse"

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

  handlers.onMouseDown?.()
  handlers.onMouseUp?.()

  expect(calls).toEqual(["press"])
})

test("runs release handler on mouse up only", () => {
  const calls: string[] = []
  const handlers = createClickOnlyMouseHandlers({
    onRelease: () => calls.push("release"),
  })

  handlers.onMouseDown?.()
  handlers.onMouseUp?.()

  expect(calls).toEqual(["release"])
})

test("supports combined selection on press and activation on release", () => {
  const calls: string[] = []
  const handlers = createClickOnlyMouseHandlers({
    onPress: () => calls.push("move"),
    onRelease: () => calls.push("activate"),
  })

  handlers.onMouseDown?.()
  handlers.onMouseUp?.()

  expect(calls).toEqual(["move", "activate"])
})
