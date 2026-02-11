import { describe, test, expect } from "bun:test"
import { resolveThemeVariant, resolveTheme, themeToCss } from "../../../../packages/ui/src/theme/resolve"
import { DEFAULT_THEMES } from "../../../../packages/ui/src/theme/default-themes"
import type { ThemeVariant, ResolvedTheme, ColorValue } from "../../../../packages/ui/src/theme/types"

const MINIMAL_SEEDS: ThemeVariant["seeds"] = {
  neutral: "#808080",
  primary: "#268bd2",
  success: "#2aa198",
  warning: "#b58900",
  error: "#dc322f",
  info: "#2aa198",
  interactive: "#268bd2",
  diffAdd: "#859900",
  diffDelete: "#dc322f",
}

function isCssVarRef(v: string): boolean {
  return v.startsWith("var(--") && v.endsWith(")")
}

function isHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v)
}

function isRgba(v: string): boolean {
  return v.startsWith("rgba(")
}

function isValidColorValue(v: string): boolean {
  return isHexColor(v) || isCssVarRef(v) || isRgba(v)
}

/** Extract the token name from a CSS var reference like var(--foo) -> foo */
function extractVarToken(ref: string): string | null {
  const match = /^var\(--(.+)\)$/.exec(ref)
  return match ? match[1] : null
}

describe("theme resolution", () => {
  describe("resolveThemeVariant", () => {
    test("returns non-empty record for dark mode", () => {
      const result = resolveThemeVariant({ seeds: MINIMAL_SEEDS }, true)
      expect(Object.keys(result).length).toBeGreaterThan(100)
    })

    test("returns non-empty record for light mode", () => {
      const result = resolveThemeVariant({ seeds: MINIMAL_SEEDS }, false)
      expect(Object.keys(result).length).toBeGreaterThan(100)
    })

    test("all token values are valid (hex, css var ref, or rgba)", () => {
      const result = resolveThemeVariant({ seeds: MINIMAL_SEEDS }, true)
      for (const [key, value] of Object.entries(result)) {
        expect(isValidColorValue(value)).toBe(true)
      }
    })

    test("key tokens exist in output", () => {
      const result = resolveThemeVariant({ seeds: MINIMAL_SEEDS }, true)
      const requiredTokens = [
        "background-base",
        "text-base",
        "text-weak",
        "text-strong",
        "border-base",
        "surface-base",
        "icon-base",
        "syntax-keyword",
        "markdown-heading",
        "markdown-text",
        "input-base",
      ]
      for (const token of requiredTokens) {
        expect(result[token]).toBeDefined()
      }
    })

    test("overrides are applied", () => {
      const override = "#abcdef"
      const result = resolveThemeVariant(
        {
          seeds: MINIMAL_SEEDS,
          overrides: { "text-base": override },
        },
        true,
      )
      expect(result["text-base"]).toBe(override)
    })

    test("CSS var references pass through unchanged", () => {
      const varRef = "var(--text-weak)" as ColorValue
      const result = resolveThemeVariant(
        {
          seeds: MINIMAL_SEEDS,
          overrides: { "markdown-heading": varRef },
        },
        true,
      )
      expect(result["markdown-heading"]).toBe("var(--text-weak)")
    })

    test("dark and light modes produce different results", () => {
      const dark = resolveThemeVariant({ seeds: MINIMAL_SEEDS }, true)
      const light = resolveThemeVariant({ seeds: MINIMAL_SEEDS }, false)
      // background-base should differ between modes
      expect(dark["background-base"]).not.toBe(light["background-base"])
    })
  })

  describe("resolveTheme", () => {
    test("returns both light and dark variants", () => {
      const theme = {
        name: "Test",
        id: "test",
        light: { seeds: MINIMAL_SEEDS },
        dark: { seeds: MINIMAL_SEEDS },
      }
      const result = resolveTheme(theme)
      expect(result.light).toBeDefined()
      expect(result.dark).toBeDefined()
      expect(Object.keys(result.light).length).toBeGreaterThan(0)
      expect(Object.keys(result.dark).length).toBeGreaterThan(0)
    })
  })

  describe("themeToCss", () => {
    test("produces valid CSS variable declarations", () => {
      const tokens: ResolvedTheme = {
        "background-base": "#000000",
        "text-base": "#ffffff",
        "syntax-keyword": "var(--text-weak)",
      }
      const css = themeToCss(tokens)
      expect(css).toContain("--background-base: #000000;")
      expect(css).toContain("--text-base: #ffffff;")
      expect(css).toContain("--syntax-keyword: var(--text-weak);")
    })

    test("handles empty token set", () => {
      const css = themeToCss({})
      expect(css).toBe("")
    })
  })

  describe("all DEFAULT_THEMES resolve without error", () => {
    const themeEntries = Object.entries(DEFAULT_THEMES)

    for (const [id, theme] of themeEntries) {
      test(`${id}: resolves dark mode`, () => {
        const result = resolveThemeVariant(theme.dark, true)
        expect(Object.keys(result).length).toBeGreaterThan(100)
      })

      test(`${id}: resolves light mode`, () => {
        const result = resolveThemeVariant(theme.light, false)
        expect(Object.keys(result).length).toBeGreaterThan(100)
      })

      test(`${id}: has key tokens in both modes`, () => {
        const dark = resolveThemeVariant(theme.dark, true)
        const light = resolveThemeVariant(theme.light, false)
        const keyTokens = ["background-base", "text-base", "syntax-keyword", "markdown-heading"]
        for (const token of keyTokens) {
          expect(dark[token]).toBeDefined()
          expect(light[token]).toBeDefined()
        }
      })
    }
  })

  describe("persona theme validation", () => {
    test("zee theme exists in DEFAULT_THEMES", () => {
      expect(DEFAULT_THEMES["zee"]).toBeDefined()
      expect(DEFAULT_THEMES["zee"].name).toBe("Zee")
    })

    test("stanley theme exists in DEFAULT_THEMES", () => {
      expect(DEFAULT_THEMES["stanley"]).toBeDefined()
      expect(DEFAULT_THEMES["stanley"].name).toBe("Stanley")
    })

    test("johny theme exists in DEFAULT_THEMES", () => {
      expect(DEFAULT_THEMES["johny"]).toBeDefined()
      expect(DEFAULT_THEMES["johny"].name).toBe("Johny")
    })

    test("zee dark seeds match canonical identity colors", () => {
      const zee = DEFAULT_THEMES["zee"]
      expect(zee.dark.seeds.interactive).toBe("#4d8aff")
      expect(zee.dark.seeds.primary).toBe("#268bd2")
    })

    test("stanley dark seeds match canonical identity colors", () => {
      const stanley = DEFAULT_THEMES["stanley"]
      expect(stanley.dark.seeds.interactive).toBe("#9acd00")
      expect(stanley.dark.seeds.primary).toBe("#859900")
    })

    test("johny dark seeds match canonical identity colors", () => {
      const johny = DEFAULT_THEMES["johny"]
      expect(johny.dark.seeds.interactive).toBe("#ff4d4d")
      expect(johny.dark.seeds.primary).toBe("#dc322f")
    })

    describe("CSS var references in overrides point to existing tokens", () => {
      const personas = ["zee", "stanley", "johny"] as const

      for (const personaId of personas) {
        for (const mode of ["dark", "light"] as const) {
          test(`${personaId} ${mode}: all var references resolve`, () => {
            const theme = DEFAULT_THEMES[personaId]
            const variant = theme[mode]
            const isDark = mode === "dark"
            const resolved = resolveThemeVariant(variant, isDark)

            for (const [key, value] of Object.entries(resolved)) {
              if (typeof value === "string" && isCssVarRef(value)) {
                const referencedToken = extractVarToken(value)
                if (referencedToken) {
                  expect(resolved[referencedToken]).toBeDefined()
                }
              }
            }
          })
        }
      }
    })

    describe("no circular CSS var references", () => {
      const personas = ["zee", "stanley", "johny"] as const

      for (const personaId of personas) {
        for (const mode of ["dark", "light"] as const) {
          test(`${personaId} ${mode}: no circular references`, () => {
            const theme = DEFAULT_THEMES[personaId]
            const variant = theme[mode]
            const isDark = mode === "dark"
            const resolved = resolveThemeVariant(variant, isDark)

            // For each token that is a var ref, follow the chain and check for cycles
            for (const [startKey, startValue] of Object.entries(resolved)) {
              if (!isCssVarRef(startValue as string)) continue

              const visited = new Set<string>()
              let current = startKey
              let value = startValue as string

              while (isCssVarRef(value)) {
                if (visited.has(current)) {
                  // Circular reference detected
                  expect(visited.has(current)).toBe(false)
                  break
                }
                visited.add(current)
                const next = extractVarToken(value)
                if (!next || !resolved[next]) break
                current = next
                value = resolved[next] as string
              }
            }
          })
        }
      }
    })
  })
})
