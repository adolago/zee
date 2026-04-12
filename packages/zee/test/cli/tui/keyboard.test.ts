import { expect, test } from "bun:test"
import { buildKittyKeyboardFlags } from "@opentui/core"
import { resolveKittyKeyboardOptions } from "../../../src/cli/cmd/tui/util/keyboard"

test("keeps Kitty keyboard protocol disabled by default", () => {
  const options = resolveKittyKeyboardOptions(undefined)
  expect(buildKittyKeyboardFlags(options)).toBe(0)
})

test("keeps Kitty keyboard protocol disabled when config is false", () => {
  const options = resolveKittyKeyboardOptions({ tui: { kitty_keyboard: false } })
  expect(buildKittyKeyboardFlags(options)).toBe(0)
})

test("enables Kitty keyboard protocol only when explicitly configured", () => {
  const options = resolveKittyKeyboardOptions({ tui: { kitty_keyboard: true } })
  expect(options.events).toBe(true)
  expect(buildKittyKeyboardFlags(options)).toBeGreaterThan(0)
})
