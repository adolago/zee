/**
 * @file Theme Context
 * @description Theme management for the TUI with NO_COLOR support
 * 
 * NO_COLOR Support:
 * This module respects the NO_COLOR environment variable (https://no-color.org/).
 * When NO_COLOR is set, a monochrome theme is used with only black, white, and gray colors.
 * This ensures the TUI remains functional but without any color output.
 */

import { SyntaxStyle, RGBA } from "@opentui/core"
import { batch, createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { createSimpleContext } from "./helper"
import selenizedDark from "./theme/selenized-dark.json" with { type: "json" }
import { useKV } from "./kv"
import { useRenderer } from "@opentui/solid"
import { createStore } from "solid-js/store"
import { Terminal } from "@tui/util/terminal"
import { buildThemeFromTerminalSnapshot } from "@tui/context/terminal-theme"

type ThemeColors = {
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  error: RGBA
  warning: RGBA
  success: RGBA
  info: RGBA
  text: RGBA
  textMuted: RGBA
  selectedListItemText: RGBA
  background: RGBA
  backgroundPanel: RGBA
  backgroundElement: RGBA
  backgroundMenu: RGBA
  border: RGBA
  borderActive: RGBA
  borderSubtle: RGBA
  diffAdded: RGBA
  diffRemoved: RGBA
  diffContext: RGBA
  diffHunkHeader: RGBA
  diffHighlightAdded: RGBA
  diffHighlightRemoved: RGBA
  diffAddedBg: RGBA
  diffRemovedBg: RGBA
  diffContextBg: RGBA
  diffLineNumber: RGBA
  diffAddedLineNumberBg: RGBA
  diffRemovedLineNumberBg: RGBA
  markdownText: RGBA
  markdownHeading: RGBA
  markdownLink: RGBA
  markdownLinkText: RGBA
  markdownCode: RGBA
  markdownBlockQuote: RGBA
  markdownEmph: RGBA
  markdownStrong: RGBA
  markdownHorizontalRule: RGBA
  markdownListItem: RGBA
  markdownListEnumeration: RGBA
  markdownImage: RGBA
  markdownImageText: RGBA
  markdownCodeBlock: RGBA
  syntaxComment: RGBA
  syntaxKeyword: RGBA
  syntaxFunction: RGBA
  syntaxVariable: RGBA
  syntaxString: RGBA
  syntaxNumber: RGBA
  syntaxType: RGBA
  syntaxOperator: RGBA
  syntaxPunctuation: RGBA
}

type Theme = ThemeColors & {
  _hasSelectedListItemText: boolean
  thinkingOpacity: number
}

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
  // If theme explicitly defines selectedListItemText, use it
  if (theme._hasSelectedListItemText) {
    return theme.selectedListItemText
  }

  // For transparent backgrounds, calculate contrast based on the actual bg (or fallback to primary)
  if (theme.background.a === 0) {
    const targetColor = bg ?? theme.primary
    const { r, g, b } = targetColor
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }

  // Fall back to background color
  return theme.background
}

type HexColor = `#${string}`
type RefName = string
type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | Variant | RGBA
type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Omit<Record<keyof ThemeColors, ColorValue>, "selectedListItemText" | "backgroundMenu"> & {
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
    thinkingOpacity?: number
  }
}

/**
 * Generate a monochrome theme for NO_COLOR mode.
 * Uses only black, white, and gray colors.
 */
export function generateMonochromeTheme(mode: "dark" | "light"): ThemeJson {
  // Define monochrome colors based on mode
  const white = RGBA.fromInts(255, 255, 255)
  const black = RGBA.fromInts(0, 0, 0)
  const gray1 = RGBA.fromInts(mode === "dark" ? 20 : 240, mode === "dark" ? 20 : 240, mode === "dark" ? 20 : 240)
  const gray2 = RGBA.fromInts(mode === "dark" ? 40 : 220, mode === "dark" ? 40 : 220, mode === "dark" ? 40 : 220)
  const gray3 = RGBA.fromInts(mode === "dark" ? 60 : 200, mode === "dark" ? 60 : 200, mode === "dark" ? 60 : 200)
  const gray4 = RGBA.fromInts(mode === "dark" ? 80 : 180, mode === "dark" ? 80 : 180, mode === "dark" ? 80 : 180)
  const gray5 = RGBA.fromInts(mode === "dark" ? 100 : 160, mode === "dark" ? 100 : 160, mode === "dark" ? 100 : 160)
  const gray6 = RGBA.fromInts(mode === "dark" ? 120 : 140, mode === "dark" ? 120 : 140, mode === "dark" ? 120 : 140)
  const gray7 = RGBA.fromInts(mode === "dark" ? 140 : 120, mode === "dark" ? 140 : 120, mode === "dark" ? 140 : 120)
  const gray8 = RGBA.fromInts(mode === "dark" ? 160 : 100, mode === "dark" ? 160 : 100, mode === "dark" ? 160 : 100)
  const gray9 = RGBA.fromInts(mode === "dark" ? 180 : 80, mode === "dark" ? 180 : 80, mode === "dark" ? 180 : 80)
  
  const bg = mode === "dark" ? black : white
  const fg = mode === "dark" ? white : black
  const textMuted = gray6

  return {
    theme: {
      // All monochrome - no colors
      primary: fg,
      secondary: fg,
      accent: fg,
      error: fg,
      warning: fg,
      success: fg,
      info: fg,
      text: fg,
      textMuted,
      selectedListItemText: bg,
      background: bg,
      backgroundPanel: gray1,
      backgroundElement: gray2,
      backgroundMenu: gray3,
      borderSubtle: gray4,
      border: gray5,
      borderActive: gray7,
      diffAdded: gray7,
      diffRemoved: gray7,
      diffContext: gray5,
      diffHunkHeader: gray6,
      diffHighlightAdded: gray8,
      diffHighlightRemoved: gray8,
      diffAddedBg: gray2,
      diffRemovedBg: gray2,
      diffContextBg: gray1,
      diffLineNumber: gray5,
      diffAddedLineNumberBg: gray3,
      diffRemovedLineNumberBg: gray3,
      markdownText: fg,
      markdownHeading: fg,
      markdownLink: fg,
      markdownLinkText: fg,
      markdownCode: gray7,
      markdownBlockQuote: gray6,
      markdownEmph: fg,
      markdownStrong: fg,
      markdownHorizontalRule: gray5,
      markdownListItem: fg,
      markdownListEnumeration: gray6,
      markdownImage: fg,
      markdownImageText: fg,
      markdownCodeBlock: gray7,
      syntaxComment: textMuted,
      syntaxKeyword: fg,
      syntaxFunction: fg,
      syntaxVariable: fg,
      syntaxString: fg,
      syntaxNumber: fg,
      syntaxType: fg,
      syntaxOperator: fg,
      syntaxPunctuation: fg,
    },
  }
}

/**
 * Check if NO_COLOR environment variable is set.
 * Follows the no-color.org standard.
 */
export function isNoColorEnabled(): boolean {
  return process.env.NO_COLOR !== undefined
}

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  ["selenized-dark"]: selenizedDark as ThemeJson,
}

const TERMINAL_THEME_SYNC_INTERVAL_MS = 1500
const TERMINAL_THEME_SIZE = 16

function sameColor(a: RGBA | null, b: RGBA | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    Math.abs(a.r - b.r) < 0.0001 &&
    Math.abs(a.g - b.g) < 0.0001 &&
    Math.abs(a.b - b.b) < 0.0001 &&
    Math.abs(a.a - b.a) < 0.0001
  )
}

export function resolveTheme(theme: ThemeJson, mode: "dark" | "light", terminalBackground?: RGBA | null) {
  const defs = theme.defs ?? {}
  function resolveColor(c: ColorValue): RGBA {
    if (c instanceof RGBA) return c
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)

      if (c.startsWith("#")) return RGBA.fromHex(c)

      if (defs[c] != null) {
        return resolveColor(defs[c])
      } else if (theme.theme[c as keyof ThemeColors] !== undefined) {
        return resolveColor(theme.theme[c as keyof ThemeColors]!)
      } else {
        throw new Error(`Color reference "${c}" not found in defs or theme`)
      }
    }
    if (typeof c === "number") {
      return ansiToRgba(c)
    }
    return resolveColor(c[mode])
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => {
        return [key, resolveColor(value as ColorValue)]
      }),
  ) as Partial<ThemeColors>

  // Handle selectedListItemText separately since it's optional
  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined
  if (hasSelectedListItemText) {
    resolved.selectedListItemText = resolveColor(theme.theme.selectedListItemText!)
  }

  // Handle backgroundMenu - optional with fallback to backgroundElement
  if (theme.theme.backgroundMenu !== undefined) {
    resolved.backgroundMenu = resolveColor(theme.theme.backgroundMenu)
  } else {
    resolved.backgroundMenu = resolved.backgroundElement
  }

  // Override background hierarchy: use the terminal background as the base color with
  // varying alpha so the terminal background shows through everywhere.
  // Only the text-protecting layers get opacity; the root background is transparent.
  const terminalBg = terminalBackground && terminalBackground.a > 0 ? terminalBackground : undefined
  if (terminalBg) {
    resolved.background = terminalBg
  }
  if (!hasSelectedListItemText) {
    // Backward compatibility: if selectedListItemText is not defined, use background color
    // This preserves the current behavior for all existing themes
    resolved.selectedListItemText = resolved.background
  }

  const baseBg = resolved.background!
  // When the theme background is transparent, we can't derive panel colors from
  // it (would be RGBA(0,0,0,alpha) = black overlay). Use a neutral base instead.
  const bgBase = baseBg.a < 0.1
    ? (mode === "dark" ? RGBA.fromInts(15, 15, 15) : RGBA.fromInts(240, 240, 240))
    : baseBg
  resolved.backgroundPanel = RGBA.fromValues(bgBase.r, bgBase.g, bgBase.b, 0.5)
  resolved.backgroundElement = RGBA.fromValues(bgBase.r, bgBase.g, bgBase.b, 0.7)
  resolved.backgroundMenu = RGBA.fromValues(bgBase.r, bgBase.g, bgBase.b, 0.95)

  // Handle thinkingOpacity - optional with default of 0.6
  const thinkingOpacity = theme.theme.thinkingOpacity ?? 0.6

  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity,
  } as Theme
}

function ansiToRgba(code: number): RGBA {
  // Standard ANSI colors (0-15)
  if (code < 16) {
    const ansiColors = [
      "#000000", // Black
      "#800000", // Red
      "#008000", // Green
      "#808000", // Yellow
      "#000080", // Blue
      "#800080", // Magenta
      "#008080", // Cyan
      "#c0c0c0", // White
      "#808080", // Bright Black
      "#ff0000", // Bright Red
      "#00ff00", // Bright Green
      "#ffff00", // Bright Yellow
      "#0000ff", // Bright Blue
      "#ff00ff", // Bright Magenta
      "#00ffff", // Bright Cyan
      "#ffffff", // Bright White
    ]
    return RGBA.fromHex(ansiColors[code] ?? "#000000")
  }

  // 6x6x6 Color Cube (16-231)
  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)

    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return RGBA.fromInts(val(r), val(g), val(b))
  }

  // Grayscale Ramp (232-255)
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }

  // Fallback for invalid codes
  return RGBA.fromInts(0, 0, 0)
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light"; terminalBackground?: RGBA | null }) => {
    const sync = useSync()
    const kv = useKV()
    const [store, setStore] = createStore({
      themes: DEFAULT_THEMES,
      mode: props.mode,
      active: "selenized-dark",
      ready: false,
      terminalBackground: props.terminalBackground ?? null,
      terminalSnapshot:
        props.terminalBackground
          ? ({
              palette: Array.from({ length: TERMINAL_THEME_SIZE }, () => null),
              foreground: null,
              background: props.terminalBackground,
              isCompletePalette: false,
            } satisfies Terminal.PaletteSnapshot)
          : (null as Terminal.PaletteSnapshot | null),
    })

    createEffect(() => {
      void sync.data.config.theme
      setStore("active", "selenized-dark")
    })

    const renderer = useRenderer()

    function updateTerminalAppearance(snapshot: Terminal.PaletteSnapshot | null) {
      if (!snapshot) return
      const nextBackground = snapshot.background ?? null
      const nextMode = nextBackground ? Terminal.modeFromBackground(nextBackground) : null
      batch(() => {
        if (!Terminal.samePaletteSnapshot(store.terminalSnapshot, snapshot)) {
          setStore("terminalSnapshot", snapshot)
        }
        if (!sameColor(store.terminalBackground, nextBackground)) {
          setStore("terminalBackground", nextBackground)
        }
        if (nextMode && store.mode !== nextMode) {
          setStore("mode", nextMode)
        }
      })
    }

    async function refreshTerminalTheme(clearCache = false) {
      try {
        if (clearCache) {
          renderer.clearPaletteCache()
        }

        let rendererSnapshot: Terminal.PaletteSnapshot | null = null
        try {
          const colors = await renderer.getPalette({ size: TERMINAL_THEME_SIZE })
          rendererSnapshot = Terminal.snapshotFromPaletteProbe(colors, TERMINAL_THEME_SIZE)
        } catch {
          // ignore renderer palette probe errors
        }

        let mergedSnapshot = rendererSnapshot
        const needsOscFallback =
          !rendererSnapshot ||
          !rendererSnapshot.background ||
          !rendererSnapshot.foreground ||
          !rendererSnapshot.isCompletePalette

        if (needsOscFallback) {
          try {
            const oscColors = await Terminal.colors()
            const oscSnapshot = Terminal.snapshotFromOscProbe(
              {
                background: oscColors.background,
                foreground: oscColors.foreground,
                colors: oscColors.colors,
              },
              TERMINAL_THEME_SIZE,
            )
            mergedSnapshot = Terminal.mergePaletteSnapshots(rendererSnapshot, oscSnapshot, TERMINAL_THEME_SIZE)
          } catch {
            // ignore osc probe errors
          }
        }

        updateTerminalAppearance(mergedSnapshot)
      } catch {
        // ignore terminal palette probe errors
      }
    }

    function init() {
      void refreshTerminalTheme()
      setStore("active", "selenized-dark")
      setStore("ready", true)
    }

    onMount(() => {
      init()

      const handleSigusr2 = () => {
        void refreshTerminalTheme(true)
      }

      process.on("SIGUSR2", handleSigusr2)
      const interval = setInterval(() => {
        void refreshTerminalTheme(true)
      }, TERMINAL_THEME_SYNC_INTERVAL_MS)

      onCleanup(() => {
        clearInterval(interval)
        process.removeListener("SIGUSR2", handleSigusr2)
      })
    })

    const values = createMemo(() => {
      // Use monochrome theme when NO_COLOR is set
      if (isNoColorEnabled()) {
        return resolveTheme(generateMonochromeTheme(store.mode), store.mode, store.terminalBackground)
      }
      const terminalTheme = buildThemeFromTerminalSnapshot(store.terminalSnapshot, store.mode)
      if (terminalTheme) {
        return resolveTheme(terminalTheme, store.mode, store.terminalBackground)
      }
      return resolveTheme(
        store.themes[store.active] ?? store.themes["selenized-dark"],
        store.mode,
        store.terminalBackground,
      )
    })

    const syntax = createMemo(() => generateSyntax(values()))
    const subtleSyntax = createMemo(() => generateSubtleSyntax(values()))

    return {
      theme: new Proxy({} as ReturnType<typeof values>, {
        get(_target, prop) {
          // @ts-expect-error
          return values()[prop]
        },
      }),
      get selected() {
        return store.active
      },
      all() {
        return store.themes
      },
      syntax,
      subtleSyntax,
      mode() {
        return store.mode
      },
      setMode(_mode: "dark" | "light") {
        setStore("mode", _mode)
        kv.set("theme_mode", _mode)
      },
      set(theme: string) {
        const next = theme in store.themes ? theme : "selenized-dark"
        setStore("active", next)
        kv.set("theme", next)
      },
      terminalBackground() {
        return store.terminalBackground
      },
      get ready() {
        return store.ready
      },
    }
  },
})

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  const g = base.g + (overlay.g - base.g) * alpha
  const b = base.b + (overlay.b - base.b) * alpha
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
}

function generateSyntax(theme: Theme) {
  return SyntaxStyle.fromTheme(getSyntaxRules(theme))
}

function generateSubtleSyntax(theme: Theme) {
  const rules = getSyntaxRules(theme)
  return SyntaxStyle.fromTheme(
    rules.map((rule) => {
      if (rule.style.foreground) {
        const fg = rule.style.foreground
        return {
          ...rule,
          style: {
            ...rule.style,
            foreground: RGBA.fromInts(
              Math.round(fg.r * 255),
              Math.round(fg.g * 255),
              Math.round(fg.b * 255),
              Math.round(theme.thinkingOpacity * 255),
            ),
          },
        }
      }
      return rule
    }),
  )
}

function getSyntaxRules(theme: Theme) {
  return [
    {
      scope: ["default"],
      style: {
        foreground: theme.text,
      },
    },
    {
      scope: ["prompt"],
      style: {
        foreground: theme.accent,
      },
    },
    {
      scope: ["extmark.file"],
      style: {
        foreground: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["extmark.agent"],
      style: {
        foreground: theme.secondary,
        bold: true,
      },
    },
    {
      scope: ["extmark.paste"],
      style: {
        foreground: theme.background,
        background: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["comment"],
      style: {
        foreground: theme.syntaxComment,
        italic: true,
      },
    },
    {
      scope: ["comment.documentation"],
      style: {
        foreground: theme.syntaxComment,
        italic: true,
      },
    },
    {
      scope: ["string", "symbol"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["number", "boolean"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["character.special"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.type"],
      style: {
        foreground: theme.syntaxType,
        bold: true,
        italic: true,
      },
    },
    {
      scope: ["keyword.function", "function.method"],
      style: {
        foreground: theme.syntaxFunction,
      },
    },
    {
      scope: ["keyword"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.import"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["operator", "keyword.operator", "punctuation.delimiter"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["keyword.conditional.ternary"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["variable", "variable.parameter", "function.method.call", "function.call"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["variable.member", "function", "constructor"],
      style: {
        foreground: theme.syntaxFunction,
      },
    },
    {
      scope: ["type", "module"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["constant"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["property"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["class"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["parameter"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["punctuation", "punctuation.bracket"],
      style: {
        foreground: theme.syntaxPunctuation,
      },
    },
    {
      scope: ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["variable.super"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["string.escape", "string.regexp"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["keyword.directive"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["punctuation.special"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["keyword.modifier"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    {
      scope: ["keyword.exception"],
      style: {
        foreground: theme.syntaxKeyword,
        italic: true,
      },
    },
    // Markdown specific styles
    {
      scope: ["markup.heading"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.1"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.2"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.3"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.4"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.5"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.6"],
      style: {
        foreground: theme.markdownHeading,
        bold: true,
      },
    },
    {
      scope: ["markup.bold", "markup.strong"],
      style: {
        foreground: theme.markdownStrong,
        bold: true,
      },
    },
    {
      scope: ["markup.italic"],
      style: {
        foreground: theme.markdownEmph,
        italic: true,
      },
    },
    {
      scope: ["markup.list"],
      style: {
        foreground: theme.markdownListItem,
      },
    },
    {
      scope: ["markup.quote"],
      style: {
        foreground: theme.markdownBlockQuote,
        italic: true,
      },
    },
    {
      scope: ["markup.raw", "markup.raw.block"],
      style: {
        foreground: theme.markdownCode,
      },
    },
    {
      scope: ["markup.raw.inline"],
      style: {
        foreground: theme.markdownCode,
        background: theme.background,
      },
    },
    {
      scope: ["markup.link"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["markup.link.label"],
      style: {
        foreground: theme.markdownLinkText,
        underline: true,
      },
    },
    {
      scope: ["markup.link.url"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["label"],
      style: {
        foreground: theme.markdownLinkText,
      },
    },
    {
      scope: ["spell", "nospell"],
      style: {
        foreground: theme.text,
      },
    },
    {
      scope: ["conceal"],
      style: {
        foreground: theme.textMuted,
      },
    },
    // Additional common highlight groups
    {
      scope: ["string.special", "string.special.url"],
      style: {
        foreground: theme.markdownLink,
        underline: true,
      },
    },
    {
      scope: ["character"],
      style: {
        foreground: theme.syntaxString,
      },
    },
    {
      scope: ["float"],
      style: {
        foreground: theme.syntaxNumber,
      },
    },
    {
      scope: ["comment.error"],
      style: {
        foreground: theme.error,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["comment.warning"],
      style: {
        foreground: theme.warning,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["comment.todo", "comment.note"],
      style: {
        foreground: theme.info,
        italic: true,
        bold: true,
      },
    },
    {
      scope: ["namespace"],
      style: {
        foreground: theme.syntaxType,
      },
    },
    {
      scope: ["field"],
      style: {
        foreground: theme.syntaxVariable,
      },
    },
    {
      scope: ["type.definition"],
      style: {
        foreground: theme.syntaxType,
        bold: true,
      },
    },
    {
      scope: ["keyword.export"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["attribute", "annotation"],
      style: {
        foreground: theme.warning,
      },
    },
    {
      scope: ["tag"],
      style: {
        foreground: theme.error,
      },
    },
    {
      scope: ["tag.attribute"],
      style: {
        foreground: theme.syntaxKeyword,
      },
    },
    {
      scope: ["tag.delimiter"],
      style: {
        foreground: theme.syntaxOperator,
      },
    },
    {
      scope: ["markup.strikethrough"],
      style: {
        foreground: theme.textMuted,
      },
    },
    {
      scope: ["markup.underline"],
      style: {
        foreground: theme.text,
        underline: true,
      },
    },
    {
      scope: ["markup.list.checked"],
      style: {
        foreground: theme.success,
      },
    },
    {
      scope: ["markup.list.unchecked"],
      style: {
        foreground: theme.textMuted,
      },
    },
    {
      scope: ["diff.plus"],
      style: {
        foreground: theme.diffAdded,
        background: theme.diffAddedBg,
      },
    },
    {
      scope: ["diff.minus"],
      style: {
        foreground: theme.diffRemoved,
        background: theme.diffRemovedBg,
      },
    },
    {
      scope: ["diff.delta"],
      style: {
        foreground: theme.diffContext,
        background: theme.diffContextBg,
      },
    },
    {
      scope: ["error"],
      style: {
        foreground: theme.error,
        bold: true,
      },
    },
    {
      scope: ["warning"],
      style: {
        foreground: theme.warning,
        bold: true,
      },
    },
    {
      scope: ["info"],
      style: {
        foreground: theme.info,
      },
    },
    {
      scope: ["debug"],
      style: {
        foreground: theme.textMuted,
      },
    },
    // Grammar/spelling error styles for real-time checking
    {
      scope: ["extmark.error.spelling"],
      style: {
        foreground: theme.warning,
        underline: true,
      },
    },
    {
      scope: ["extmark.error.grammar"],
      style: {
        foreground: theme.error,
        underline: true,
      },
    },
    {
      scope: ["extmark.error.style"],
      style: {
        foreground: theme.info,
        underline: true,
      },
    },
  ]
}
