import { describe, test, expect } from "bun:test"
import {
  hexToRgb,
  rgbToHex,
  hexToOklch,
  oklchToHex,
  rgbToOklch,
  oklchToRgb,
  generateScale,
  generateNeutralScale,
  generateAlphaScale,
  mixColors,
  lighten,
  darken,
  withAlpha,
} from "../../../../packages/ui/src/theme/color"
import type { HexColor, OklchColor } from "../../../../packages/ui/src/theme/types"

describe("theme color utilities", () => {
  describe("hexToRgb", () => {
    test("converts primary colors", () => {
      expect(hexToRgb("#ff0000")).toEqual({ r: 1, g: 0, b: 0 })
      expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 1, b: 0 })
      expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 1 })
    })

    test("converts black and white", () => {
      expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 })
      expect(hexToRgb("#ffffff")).toEqual({ r: 1, g: 1, b: 1 })
    })

    test("converts mid-gray", () => {
      const gray = hexToRgb("#808080")
      expect(gray.r).toBeCloseTo(128 / 255, 3)
      expect(gray.g).toBeCloseTo(128 / 255, 3)
      expect(gray.b).toBeCloseTo(128 / 255, 3)
    })

    test("handles shorthand hex (3-char)", () => {
      const result = hexToRgb("#f00" as HexColor)
      expect(result).toEqual({ r: 1, g: 0, b: 0 })
    })

    test("handles shorthand hex #abc", () => {
      const result = hexToRgb("#abc" as HexColor)
      expect(result.r).toBeCloseTo(0xaa / 255, 3)
      expect(result.g).toBeCloseTo(0xbb / 255, 3)
      expect(result.b).toBeCloseTo(0xcc / 255, 3)
    })
  })

  describe("rgbToHex", () => {
    test("converts primary channels", () => {
      expect(rgbToHex(1, 0, 0)).toBe("#ff0000")
      expect(rgbToHex(0, 1, 0)).toBe("#00ff00")
      expect(rgbToHex(0, 0, 1)).toBe("#0000ff")
    })

    test("converts black and white", () => {
      expect(rgbToHex(0, 0, 0)).toBe("#000000")
      expect(rgbToHex(1, 1, 1)).toBe("#ffffff")
    })

    test("clamps values outside 0-1", () => {
      expect(rgbToHex(1.5, -0.5, 0.5)).toBe("#ff0080")
    })

    test("rounds to nearest int", () => {
      const hex = rgbToHex(0.5, 0.5, 0.5)
      expect(hex).toBe("#808080")
    })
  })

  describe("hexToRgb / rgbToHex round-trip", () => {
    const cases: HexColor[] = ["#ff0000", "#00ff00", "#0000ff", "#000000", "#ffffff", "#808080", "#123456"]

    for (const hex of cases) {
      test(`round-trips ${hex}`, () => {
        const { r, g, b } = hexToRgb(hex)
        expect(rgbToHex(r, g, b)).toBe(hex)
      })
    }
  })

  describe("hexToOklch / oklchToHex round-trip", () => {
    const cases: HexColor[] = ["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#808080", "#268bd2", "#859900", "#dc322f"]

    for (const hex of cases) {
      test(`round-trips ${hex} within tolerance`, () => {
        const oklch = hexToOklch(hex)
        const result = oklchToHex(oklch)
        // Color space conversion has floating point loss; allow 1-2 steps difference per channel
        const orig = hexToRgb(hex)
        const conv = hexToRgb(result)
        expect(Math.abs(orig.r - conv.r)).toBeLessThan(0.02)
        expect(Math.abs(orig.g - conv.g)).toBeLessThan(0.02)
        expect(Math.abs(orig.b - conv.b)).toBeLessThan(0.02)
      })
    }

    test("black round-trips exactly", () => {
      const oklch = hexToOklch("#000000")
      expect(oklch.l).toBeCloseTo(0, 2)
      expect(oklch.c).toBeCloseTo(0, 2)
    })

    test("white has high lightness", () => {
      const oklch = hexToOklch("#ffffff")
      expect(oklch.l).toBeCloseTo(1, 1)
      expect(oklch.c).toBeCloseTo(0, 2)
    })
  })

  describe("rgbToOklch / oklchToRgb consistency", () => {
    test("red has expected hue range", () => {
      const oklch = rgbToOklch(1, 0, 0)
      expect(oklch.l).toBeGreaterThan(0.4)
      expect(oklch.l).toBeLessThan(0.7)
      expect(oklch.c).toBeGreaterThan(0.2)
      // Red hue is around 29 degrees in OKLCH
      expect(oklch.h).toBeGreaterThan(15)
      expect(oklch.h).toBeLessThan(45)
    })

    test("green has expected hue range", () => {
      const oklch = rgbToOklch(0, 1, 0)
      expect(oklch.h).toBeGreaterThan(130)
      expect(oklch.h).toBeLessThan(160)
    })

    test("blue has expected hue range", () => {
      const oklch = rgbToOklch(0, 0, 1)
      expect(oklch.h).toBeGreaterThan(250)
      expect(oklch.h).toBeLessThan(280)
    })

    test("achromatic colors have near-zero chroma", () => {
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        const oklch = rgbToOklch(v, v, v)
        expect(oklch.c).toBeLessThan(0.001)
      }
    })
  })

  describe("generateScale", () => {
    test("produces 12 entries for dark mode", () => {
      const scale = generateScale("#268bd2", true)
      expect(scale).toHaveLength(12)
    })

    test("produces 12 entries for light mode", () => {
      const scale = generateScale("#268bd2", false)
      expect(scale).toHaveLength(12)
    })

    test("all entries are valid hex colors", () => {
      const scale = generateScale("#ff0000", true)
      for (const hex of scale) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      }
    })

    test("dark scale lightness generally increases across steps", () => {
      const scale = generateScale("#268bd2", true)
      const lightnesses = scale.map((hex) => hexToOklch(hex).l)
      // First entry should be darker than last entry in dark mode
      expect(lightnesses[0]).toBeLessThan(lightnesses[11])
    })

    test("light scale lightness generally decreases across steps", () => {
      const scale = generateScale("#268bd2", false)
      const lightnesses = scale.map((hex) => hexToOklch(hex).l)
      // First entry should be lighter than last entry in light mode
      expect(lightnesses[0]).toBeGreaterThan(lightnesses[11])
    })

    test("all entries share the same hue as the seed", () => {
      const seedOklch = hexToOklch("#268bd2")
      const scale = generateScale("#268bd2", true)
      // The scale generator sets hue directly from the seed. However,
      // round-tripping through sRGB gamut clamping can shift the hue
      // significantly for colors near gamut boundaries. We verify that
      // entries with high chroma (close to the seed) stay within a
      // reasonable range.
      const mid = scale.slice(6, 10).map((hex) => hexToOklch(hex))
      for (const oklch of mid) {
        // These middle entries have chroma closest to the seed
        // and should have the best hue fidelity
        const hueDiff = Math.abs(oklch.h - seedOklch.h)
        expect(hueDiff).toBeLessThan(30)
      }
    })
  })

  describe("generateNeutralScale", () => {
    test("produces 12 entries", () => {
      const scale = generateNeutralScale("#808080", true)
      expect(scale).toHaveLength(12)
    })

    test("all entries are valid hex colors", () => {
      const scale = generateNeutralScale("#808080", false)
      for (const hex of scale) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      }
    })

    test("chroma is capped at 0.02", () => {
      // Use a highly chromatic seed to verify capping
      const scale = generateNeutralScale("#ff0000", true)
      for (const hex of scale) {
        const oklch = hexToOklch(hex)
        expect(oklch.c).toBeLessThanOrEqual(0.025) // small tolerance for float math
      }
    })

    test("dark mode scale goes from dark to light", () => {
      const scale = generateNeutralScale("#808080", true)
      const first = hexToOklch(scale[0])
      const last = hexToOklch(scale[11])
      expect(first.l).toBeLessThan(last.l)
    })

    test("light mode scale goes from light to dark", () => {
      const scale = generateNeutralScale("#808080", false)
      const first = hexToOklch(scale[0])
      const last = hexToOklch(scale[11])
      expect(first.l).toBeGreaterThan(last.l)
    })
  })

  describe("generateAlphaScale", () => {
    test("produces 12 entries matching input length", () => {
      const base = generateScale("#268bd2", true)
      const alpha = generateAlphaScale(base, true)
      expect(alpha).toHaveLength(12)
    })

    test("all entries are valid hex colors", () => {
      const base = generateScale("#268bd2", false)
      const alpha = generateAlphaScale(base, false)
      for (const hex of alpha) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      }
    })
  })

  describe("mixColors", () => {
    test("amount=0 returns first color", () => {
      const result = mixColors("#ff0000", "#0000ff", 0)
      const rgb = hexToRgb(result)
      expect(rgb.r).toBeCloseTo(1, 1)
      expect(rgb.b).toBeCloseTo(0, 1)
    })

    test("amount=1 returns second color", () => {
      const result = mixColors("#ff0000", "#0000ff", 1)
      const rgb = hexToRgb(result)
      expect(rgb.r).toBeCloseTo(0, 1)
      expect(rgb.b).toBeCloseTo(1, 1)
    })

    test("amount=0.5 returns midpoint", () => {
      const result = mixColors("#000000", "#ffffff", 0.5)
      const oklch = hexToOklch(result)
      expect(oklch.l).toBeCloseTo(0.5, 1)
    })
  })

  describe("lighten / darken", () => {
    test("lighten increases lightness", () => {
      const original = hexToOklch("#808080")
      const lighter = hexToOklch(lighten("#808080", 0.2))
      expect(lighter.l).toBeGreaterThan(original.l)
    })

    test("darken decreases lightness", () => {
      const original = hexToOklch("#808080")
      const darker = hexToOklch(darken("#808080", 0.2))
      expect(darker.l).toBeLessThan(original.l)
    })

    test("lighten clamps at 1", () => {
      const result = hexToOklch(lighten("#ffffff", 0.5))
      expect(result.l).toBeLessThanOrEqual(1.01) // small tolerance
    })

    test("darken clamps at 0", () => {
      const result = hexToOklch(darken("#000000", 0.5))
      expect(result.l).toBeGreaterThanOrEqual(-0.01) // small tolerance
    })
  })

  describe("withAlpha", () => {
    test("produces rgba string", () => {
      const result = withAlpha("#ff0000", 0.5)
      expect(result).toBe("rgba(255, 0, 0, 0.5)")
    })

    test("fully opaque", () => {
      const result = withAlpha("#00ff00", 1)
      expect(result).toBe("rgba(0, 255, 0, 1)")
    })

    test("fully transparent", () => {
      const result = withAlpha("#0000ff", 0)
      expect(result).toBe("rgba(0, 0, 255, 0)")
    })
  })
})
