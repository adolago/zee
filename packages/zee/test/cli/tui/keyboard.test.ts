import { expect, test } from "bun:test"
import { buildKittyKeyboardFlags } from "@opentui/core"
import {
  detectTerminalKeyboardProfile,
  resolveHoldToRecordSupport,
  resolveKittyKeyboard,
  resolveKittyKeyboardOptions,
} from "../../../src/cli/cmd/tui/util/keyboard"
import { Keybind } from "../../../src/util/keybind"

test("keeps Kitty keyboard protocol disabled by default", () => {
  const options = resolveKittyKeyboardOptions(undefined)
  expect(buildKittyKeyboardFlags(options)).toBe(0)
})

test("keeps Kitty keyboard protocol disabled when config is false", () => {
  const options = resolveKittyKeyboardOptions({ tui: { kitty_keyboard: false } })
  expect(buildKittyKeyboardFlags(options)).toBe(0)
})

test("enables Kitty keyboard protocol only when explicitly configured", () => {
  const resolved = resolveKittyKeyboard({ tui: { kitty_keyboard: true } }, { TERM_PROGRAM: "ghostty" })
  expect(resolved.profile).toBe("ghostty")
  expect(resolved.enabled).toBe(true)
  expect(resolved.options.events).toBe(true)
  expect(buildKittyKeyboardFlags(resolved.options)).toBeGreaterThan(0)
})

test("treats Warp as a supported Kitty keyboard terminal when explicitly configured", () => {
  const resolved = resolveKittyKeyboard({ tui: { kitty_keyboard: true } }, { TERM_PROGRAM: "WarpTerminal" })
  expect(resolved.profile).toBe("warp")
  expect(resolved.enabled).toBe(true)
  expect(resolved.warning).toBeUndefined()
  expect(buildKittyKeyboardFlags(resolved.options)).toBeGreaterThan(0)
})

test("detects terminal keyboard profiles from environment hints", () => {
  expect(detectTerminalKeyboardProfile({ TERM_PROGRAM: "kitty" })).toBe("kitty")
  expect(detectTerminalKeyboardProfile({ TERM_PROGRAM: "ghostty" })).toBe("ghostty")
  expect(detectTerminalKeyboardProfile({ TERM_PROGRAM: "WarpTerminal" })).toBe("warp")
  expect(detectTerminalKeyboardProfile({ TERM_PROGRAM: "WezTerm" })).toBe("wezterm")
  expect(detectTerminalKeyboardProfile({ WT_SESSION: "1" })).toBe("windows-terminal")
})

test("warns and falls back when Kitty keyboard is forced on an unsupported terminal", () => {
  const resolved = resolveKittyKeyboard({ tui: { kitty_keyboard: true } }, { WT_SESSION: "1" })
  expect(resolved.profile).toBe("windows-terminal")
  expect(resolved.enabled).toBe(false)
  expect(buildKittyKeyboardFlags(resolved.options)).toBe(0)
  expect(resolved.warning).toContain("Windows Terminal")
})

test("allows hold-to-record when Kitty keyboard is enabled on a supported terminal", () => {
  const kittyKeyboard = resolveKittyKeyboard({ tui: { kitty_keyboard: true } }, { TERM_PROGRAM: "kitty" })
  const hold = resolveHoldToRecordSupport({
    bindings: Keybind.parse("alt"),
    kittyKeyboard,
  })

  expect(hold.enabled).toBe(true)
  expect(hold.warning).toBeUndefined()
})

test("disables hold-to-record with a warning when Kitty keyboard is not enabled", () => {
  const kittyKeyboard = resolveKittyKeyboard({ tui: { kitty_keyboard: false } }, { TERM_PROGRAM: "kitty" })
  const hold = resolveHoldToRecordSupport({
    bindings: Keybind.parse("alt"),
    kittyKeyboard,
  })

  expect(hold.enabled).toBe(false)
  expect(hold.warning).toContain("tui.kitty_keyboard=true")
})

test("disables hold-to-record on unsupported terminals even when Kitty keyboard is requested", () => {
  const kittyKeyboard = resolveKittyKeyboard({ tui: { kitty_keyboard: true } }, { TERM_PROGRAM: "WezTerm" })
  const hold = resolveHoldToRecordSupport({
    bindings: Keybind.parse("alt"),
    kittyKeyboard,
  })

  expect(hold.enabled).toBe(false)
  expect(hold.warning).toContain("WezTerm")
})

test("allows hold-to-record when Kitty keyboard is enabled in Warp", () => {
  const kittyKeyboard = resolveKittyKeyboard({ tui: { kitty_keyboard: true } }, { TERM_PROGRAM: "WarpTerminal" })
  const hold = resolveHoldToRecordSupport({
    bindings: Keybind.parse("alt"),
    kittyKeyboard,
  })

  expect(hold.enabled).toBe(true)
  expect(hold.warning).toBeUndefined()
})
