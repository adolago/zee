import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { Terminal } from "@tui/util/terminal"
import { buildThemeFromTerminalSnapshot } from "@tui/context/terminal-theme"

function expectColor(actual: RGBA, expected: RGBA) {
  expect(actual.r).toBeCloseTo(expected.r, 5)
  expect(actual.g).toBeCloseTo(expected.g, 5)
  expect(actual.b).toBeCloseTo(expected.b, 5)
  expect(actual.a).toBeCloseTo(expected.a, 5)
}

function luminance(color: RGBA): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
}

describe("terminal theme mapping", () => {
  test("returns null when snapshot has no usable color data", () => {
    const snapshot: Terminal.PaletteSnapshot = {
      palette: Array.from({ length: 16 }, () => null),
      foreground: null,
      background: null,
      isCompletePalette: false,
    }

    expect(buildThemeFromTerminalSnapshot(snapshot, "dark")).toBeNull()
  })

  test("builds a complete theme from fg/bg fallback when palette is incomplete", () => {
    const bg = RGBA.fromInts(18, 18, 18)
    const fg = RGBA.fromInts(225, 225, 225)
    const snapshot: Terminal.PaletteSnapshot = {
      palette: Array.from({ length: 16 }, () => null),
      foreground: fg,
      background: bg,
      isCompletePalette: false,
    }

    const built = buildThemeFromTerminalSnapshot(snapshot, "dark")
    expect(built).not.toBeNull()
    if (!built) return

    expectColor(built.theme.background, bg)
    expectColor(built.theme.text, fg)
    expect(built.theme.primary).toBeDefined()
    expect(built.theme.warning).toBeDefined()
    expect(built.theme.syntaxKeyword).toBeDefined()
    expect(built.theme.markdownHeading).toBeDefined()
  })

  test("maps key semantic roles from terminal ANSI palette", () => {
    const palette = [
      RGBA.fromHex("#111111"), // 0
      RGBA.fromHex("#aa2222"), // 1
      RGBA.fromHex("#22aa22"), // 2
      RGBA.fromHex("#aaaa22"), // 3
      RGBA.fromHex("#2266dd"), // 4
      RGBA.fromHex("#aa33aa"), // 5
      RGBA.fromHex("#22aaaa"), // 6
      RGBA.fromHex("#dddddd"), // 7
      RGBA.fromHex("#555555"), // 8
      RGBA.fromHex("#ff5555"), // 9
      RGBA.fromHex("#55ff55"), // 10
      RGBA.fromHex("#ffff55"), // 11
      RGBA.fromHex("#5599ff"), // 12
      RGBA.fromHex("#ff55ff"), // 13
      RGBA.fromHex("#55ffff"), // 14
      RGBA.fromHex("#ffffff"), // 15
    ]

    const snapshot: Terminal.PaletteSnapshot = {
      palette,
      foreground: RGBA.fromHex("#e6e6e6"),
      background: RGBA.fromHex("#121212"),
      isCompletePalette: true,
    }

    const built = buildThemeFromTerminalSnapshot(snapshot, "dark")
    expect(built).not.toBeNull()
    if (!built) return

    const theme = built.theme
    expectColor(theme.primary as RGBA, palette[12]!)
    expectColor(theme.secondary as RGBA, palette[13]!)
    expectColor(theme.accent as RGBA, palette[14]!)
    expectColor(theme.success as RGBA, palette[10]!)
    expectColor(theme.warning as RGBA, palette[11]!)
    expectColor(theme.error as RGBA, palette[9]!)
    expectColor(theme.syntaxKeyword as RGBA, palette[12]!)
    expectColor(theme.syntaxString as RGBA, palette[10]!)
    expectColor(theme.syntaxVariable as RGBA, palette[9]!)
  })

  test("forces readable text when foreground and background are too similar", () => {
    const snapshot: Terminal.PaletteSnapshot = {
      palette: Array.from({ length: 16 }, () => null),
      foreground: RGBA.fromHex("#151515"),
      background: RGBA.fromHex("#141414"),
      isCompletePalette: false,
    }

    const built = buildThemeFromTerminalSnapshot(snapshot, "dark")
    expect(built).not.toBeNull()
    if (!built) return

    const text = built.theme.text as RGBA
    const bg = built.theme.background as RGBA
    expect(Math.abs(luminance(text) - luminance(bg))).toBeGreaterThan(0.5)
  })
})
