import { expect, test } from "bun:test"

import {
  describeTerminalProfile,
  detectTerminalProfile,
  resolveTerminalProbePolicy,
  supportsColorOutput,
  supportsUnicodeOutput,
} from "../../src/cli/terminal-capabilities"

test("detects Warp from TERM_PROGRAM", () => {
  expect(detectTerminalProfile({ TERM_PROGRAM: "WarpTerminal" })).toBe("warp")
})

test("describes terminal profiles with user-facing names", () => {
  expect(describeTerminalProfile("windows-terminal")).toBe("Windows Terminal")
  expect(describeTerminalProfile("unknown")).toBe("unknown terminal")
})

test("treats Warp on Windows as Unicode-capable", () => {
  expect(
    supportsUnicodeOutput({
      env: { TERM_PROGRAM: "WarpTerminal" },
      platform: "win32",
    }),
  ).toBe(true)
})

test("treats Windows Terminal on Windows as Unicode-capable", () => {
  expect(
    supportsUnicodeOutput({
      env: { WT_SESSION: "1" },
      platform: "win32",
    }),
  ).toBe(true)
})

test("keeps plain Windows terminals on ASCII by default", () => {
  expect(
    supportsUnicodeOutput({
      env: {},
      platform: "win32",
    }),
  ).toBe(false)
})

test("respects Unicode precedence flags", () => {
  expect(
    supportsUnicodeOutput({
      env: { TERM_PROGRAM: "WarpTerminal", NO_COLOR: "1", FORCE_UNICODE: "1" },
      platform: "win32",
    }),
  ).toBe(false)

  expect(
    supportsUnicodeOutput({
      env: { FORCE_UNICODE: "1" },
      platform: "win32",
      isTTY: false,
    }),
  ).toBe(true)

  expect(
    supportsUnicodeOutput({
      env: { TERM_PROGRAM: "WarpTerminal", ASCII_ONLY: "1" },
      platform: "win32",
    }),
  ).toBe(false)
})

test("respects color precedence flags", () => {
  expect(
    supportsColorOutput({
      env: { FORCE_COLOR: "1" },
      isTTY: false,
    }),
  ).toBe(true)

  expect(
    supportsColorOutput({
      env: { NO_COLOR: "1", FORCE_COLOR: "1" },
      isTTY: true,
    }),
  ).toBe(false)
})

test("disables OSC color probing on Windows terminals", () => {
  expect(
    resolveTerminalProbePolicy({
      env: { TERM_PROGRAM: "WarpTerminal" },
      platform: "win32",
    }),
  ).toEqual({ allowOscColorQueries: false })
})

test("keeps OSC color probing available on non-Windows terminals", () => {
  expect(
    resolveTerminalProbePolicy({
      env: { TERM_PROGRAM: "ghostty" },
      platform: "linux",
    }),
  ).toEqual({ allowOscColorQueries: true })
})
