import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { Terminal } from "@tui/util/terminal"

function channelToByte(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return Math.round(value <= 1 ? value * 255 : value)
}

function expectColor(
  color: ReturnType<typeof Terminal.parseTerminalColor>,
  expected: { r: number; g: number; b: number; a?: number },
) {
  expect(color).not.toBeNull()
  if (!color) return

  expect(channelToByte(color.r)).toBe(expected.r)
  expect(channelToByte(color.g)).toBe(expected.g)
  expect(channelToByte(color.b)).toBe(expected.b)
  expect(channelToByte(color.a)).toBe(expected.a ?? 255)
}

describe("terminal theme parsing", () => {
  test("parses rgb: with 16-bit components", () => {
    expectColor(Terminal.parseTerminalColor("rgb:ffff/0000/8080"), { r: 255, g: 0, b: 128 })
  })

  test("parses rgb: with 8-bit components", () => {
    expectColor(Terminal.parseTerminalColor("rgb:ff/00/80"), { r: 255, g: 0, b: 128 })
  })

  test("parses rgba: with alpha component", () => {
    expectColor(Terminal.parseTerminalColor("rgba:ff/80/00/80"), { r: 255, g: 128, b: 0, a: 128 })
  })

  test("parses shorthand hex with alpha", () => {
    expectColor(Terminal.parseTerminalColor("#1234"), { r: 17, g: 34, b: 51, a: 68 })
  })

  test("parses css rgba()", () => {
    expectColor(Terminal.parseTerminalColor("rgba(255, 128, 0, 0.5)"), { r: 255, g: 128, b: 0, a: 128 })
  })

  test("returns null for unsupported color", () => {
    expect(Terminal.parseTerminalColor("not-a-color")).toBeNull()
  })
})

describe("terminal theme mode inference", () => {
  test("defaults to dark when background is unavailable", () => {
    expect(Terminal.modeFromBackground(null)).toBe("dark")
  })

  test("detects light backgrounds", () => {
    const bg = Terminal.parseTerminalColor("#ffffff")
    expect(Terminal.modeFromBackground(bg)).toBe("light")
  })

  test("detects dark backgrounds", () => {
    const bg = Terminal.parseTerminalColor("#000000")
    expect(Terminal.modeFromBackground(bg)).toBe("dark")
  })
})

describe("terminal palette snapshots", () => {
  test("normalizes renderer palette probe", () => {
    const snapshot = Terminal.snapshotFromPaletteProbe({
      palette: [
        "#000000",
        "#ff0000",
        "#00ff00",
        "#ffff00",
        "#0000ff",
        "#ff00ff",
        "#00ffff",
        "#ffffff",
        "#808080",
        "#ff6666",
        "#66ff66",
        "#ffff66",
        "#6699ff",
        "#ff66ff",
        "#66ffff",
        "#f0f0f0",
      ],
      defaultForeground: "#d0d0d0",
      defaultBackground: "#101010",
    })

    expect(snapshot.isCompletePalette).toBe(true)
    expect(snapshot.palette).toHaveLength(16)
    expect(channelToByte(snapshot.foreground?.r)).toBe(208)
    expect(channelToByte(snapshot.background?.r)).toBe(16)
  })

  test("normalizes OSC probe with sparse colors", () => {
    const oscColors: Array<RGBA | undefined> = []
    oscColors[0] = RGBA.fromInts(16, 16, 16)
    oscColors[1] = RGBA.fromInts(220, 80, 80)
    const snapshot = Terminal.snapshotFromOscProbe({
      background: RGBA.fromInts(10, 10, 10),
      foreground: RGBA.fromInts(240, 240, 240),
      colors: oscColors,
    })

    expect(snapshot.isCompletePalette).toBe(false)
    expect(channelToByte(snapshot.palette[0]?.r)).toBe(16)
    expect(snapshot.palette[2]).toBeNull()
    expect(channelToByte(snapshot.background?.r)).toBe(10)
  })

  test("merges renderer and OSC snapshots with renderer priority", () => {
    const rendererSnapshot = Terminal.snapshotFromPaletteProbe({
      palette: Array.from({ length: 16 }, () => null),
      defaultForeground: "#aaaaaa",
      defaultBackground: null,
    })

    const oscPalette: Array<RGBA | undefined> = Array.from({ length: 16 }, (_v, i) => RGBA.fromInts(i * 10, i * 10, i * 10))
    const oscSnapshot = Terminal.snapshotFromOscProbe({
      background: RGBA.fromInts(20, 20, 20),
      foreground: RGBA.fromInts(240, 240, 240),
      colors: oscPalette,
    })

    const merged = Terminal.mergePaletteSnapshots(rendererSnapshot, oscSnapshot)
    expect(merged).not.toBeNull()
    if (!merged) return

    // Renderer foreground wins.
    expect(channelToByte(merged.foreground?.r)).toBe(170)
    // OSC background fills missing renderer background.
    expect(channelToByte(merged.background?.r)).toBe(20)
    // OSC palette fills missing renderer palette.
    expect(channelToByte(merged.palette[5]?.r)).toBe(50)
  })

  test("compares snapshots", () => {
    const a = Terminal.snapshotFromPaletteProbe({
      palette: Array.from({ length: 16 }, () => "#101010"),
      defaultForeground: "#eeeeee",
      defaultBackground: "#111111",
    })
    const b = Terminal.snapshotFromPaletteProbe({
      palette: Array.from({ length: 16 }, () => "#101010"),
      defaultForeground: "#eeeeee",
      defaultBackground: "#111111",
    })
    const c = Terminal.snapshotFromPaletteProbe({
      palette: Array.from({ length: 16 }, () => "#202020"),
      defaultForeground: "#eeeeee",
      defaultBackground: "#111111",
    })

    expect(Terminal.samePaletteSnapshot(a, b)).toBe(true)
    expect(Terminal.samePaletteSnapshot(a, c)).toBe(false)
  })

  test("disables OSC color queries on Windows Warp", () => {
    expect(
      Terminal.shouldUseOscColorQueries({
        env: { TERM_PROGRAM: "WarpTerminal" },
        platform: "win32",
      }),
    ).toBe(false)
  })

  test("keeps OSC color queries enabled on non-Windows terminals", () => {
    expect(
      Terminal.shouldUseOscColorQueries({
        env: { TERM_PROGRAM: "ghostty" },
        platform: "linux",
      }),
    ).toBe(true)
  })
})
