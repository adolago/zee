import { expect, test } from "bun:test"

import { buildTuiRenderOptions } from "../../../src/cli/cmd/tui/util/render-options"
import { KITTY_KEYBOARD_DISABLED, resolveKittyKeyboard } from "../../../src/cli/cmd/tui/util/keyboard"

test("disables mouse movement reporting in the TUI render config", () => {
  const options = buildTuiRenderOptions({ options: KITTY_KEYBOARD_DISABLED })

  expect(options.enableMouseMovement).toBe(false)
  expect(options.exitOnCtrlC).toBe(false)
  expect(options.targetFps).toBe(60)
  expect(options.useKittyKeyboard).toEqual(KITTY_KEYBOARD_DISABLED)
})

test("passes resolved Warp kitty-keyboard options into the renderer", () => {
  const kittyKeyboard = resolveKittyKeyboard({ tui: { kitty_keyboard: true } }, { TERM_PROGRAM: "WarpTerminal" })
  const options = buildTuiRenderOptions(kittyKeyboard)

  expect(kittyKeyboard.enabled).toBe(true)
  expect(options.useKittyKeyboard).toEqual(kittyKeyboard.options)
})
