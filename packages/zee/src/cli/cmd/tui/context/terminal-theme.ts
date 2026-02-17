import { RGBA } from "@opentui/core"
import { Terminal } from "@tui/util/terminal"

export type TerminalThemeJson = {
  theme: {
    primary: RGBA
    secondary: RGBA
    accent: RGBA
    error: RGBA
    warning: RGBA
    success: RGBA
    info: RGBA
    text: RGBA
    textMuted: RGBA
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
    thinkingOpacity: number
  }
}

function colorLuminance(color: RGBA): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
}

function mixColors(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  const g = base.g + (overlay.g - base.g) * alpha
  const b = base.b + (overlay.b - base.b) * alpha
  return RGBA.fromValues(r, g, b, 1)
}

function ensureReadableText(fg: RGBA, bg: RGBA): RGBA {
  const delta = Math.abs(colorLuminance(fg) - colorLuminance(bg))
  if (delta >= 0.32) return fg
  const black = RGBA.fromInts(0, 0, 0)
  const white = RGBA.fromInts(255, 255, 255)
  const blackDelta = Math.abs(colorLuminance(black) - colorLuminance(bg))
  const whiteDelta = Math.abs(colorLuminance(white) - colorLuminance(bg))
  return whiteDelta >= blackDelta ? white : black
}

function hasTerminalSnapshot(snapshot: Terminal.PaletteSnapshot | null): snapshot is Terminal.PaletteSnapshot {
  if (!snapshot) return false
  if (snapshot.background || snapshot.foreground) return true
  return snapshot.palette.some((color) => Boolean(color))
}

function pickPaletteColor(snapshot: Terminal.PaletteSnapshot, ...indices: number[]): RGBA | null {
  for (const index of indices) {
    const color = snapshot.palette[index]
    if (color) return color
  }
  return null
}

export function buildThemeFromTerminalSnapshot(
  snapshot: Terminal.PaletteSnapshot | null,
  mode: "dark" | "light",
): TerminalThemeJson | null {
  if (!hasTerminalSnapshot(snapshot)) return null

  const fallbackBackground = mode === "dark" ? RGBA.fromInts(15, 15, 15) : RGBA.fromInts(245, 245, 245)
  const fallbackForeground = mode === "dark" ? RGBA.fromInts(235, 235, 235) : RGBA.fromInts(25, 25, 25)
  const background = snapshot.background ?? pickPaletteColor(snapshot, 0, 8) ?? fallbackBackground
  const rawForeground = snapshot.foreground ?? pickPaletteColor(snapshot, mode === "dark" ? 15 : 0, 7, 8) ?? fallbackForeground
  const text = ensureReadableText(rawForeground, background)
  const textMuted = ensureReadableText(mixColors(text, background, mode === "dark" ? 0.52 : 0.44), background)

  const fallbackPrimary = mode === "dark" ? RGBA.fromInts(90, 167, 255) : RGBA.fromInts(0, 95, 175)
  const fallbackSecondary = mode === "dark" ? RGBA.fromInts(214, 128, 255) : RGBA.fromInts(138, 43, 226)
  const fallbackAccent = mode === "dark" ? RGBA.fromInts(64, 198, 200) : RGBA.fromInts(0, 139, 139)
  const fallbackError = mode === "dark" ? RGBA.fromInts(255, 99, 99) : RGBA.fromInts(191, 52, 52)
  const fallbackWarning = mode === "dark" ? RGBA.fromInts(232, 196, 73) : RGBA.fromInts(166, 124, 0)
  const fallbackSuccess = mode === "dark" ? RGBA.fromInts(120, 203, 116) : RGBA.fromInts(34, 127, 66)

  const primary = pickPaletteColor(snapshot, 12, 4) ?? fallbackPrimary
  const secondary = pickPaletteColor(snapshot, 13, 5) ?? fallbackSecondary
  const accent = pickPaletteColor(snapshot, 14, 6) ?? fallbackAccent
  const error = pickPaletteColor(snapshot, 9, 1) ?? fallbackError
  const warning = pickPaletteColor(snapshot, 11, 3) ?? fallbackWarning
  const success = pickPaletteColor(snapshot, 10, 2) ?? fallbackSuccess
  const info = pickPaletteColor(snapshot, 6, 14, 12, 4) ?? accent

  return {
    theme: {
      primary,
      secondary,
      accent,
      error,
      warning,
      success,
      info,
      text,
      textMuted,
      background,
      backgroundPanel: mixColors(background, text, mode === "dark" ? 0.06 : 0.03),
      backgroundElement: mixColors(background, text, mode === "dark" ? 0.1 : 0.06),
      backgroundMenu: mixColors(background, text, mode === "dark" ? 0.15 : 0.1),
      border: mixColors(background, text, mode === "dark" ? 0.26 : 0.22),
      borderActive: accent,
      borderSubtle: mixColors(background, text, mode === "dark" ? 0.16 : 0.12),
      diffAdded: success,
      diffRemoved: error,
      diffContext: textMuted,
      diffHunkHeader: primary,
      diffHighlightAdded: pickPaletteColor(snapshot, 10, 2) ?? success,
      diffHighlightRemoved: pickPaletteColor(snapshot, 9, 1) ?? error,
      diffAddedBg: mixColors(background, success, mode === "dark" ? 0.25 : 0.16),
      diffRemovedBg: mixColors(background, error, mode === "dark" ? 0.25 : 0.16),
      diffContextBg: mixColors(background, text, mode === "dark" ? 0.08 : 0.05),
      diffLineNumber: textMuted,
      diffAddedLineNumberBg: mixColors(background, success, mode === "dark" ? 0.34 : 0.2),
      diffRemovedLineNumberBg: mixColors(background, error, mode === "dark" ? 0.34 : 0.2),
      markdownText: text,
      markdownHeading: pickPaletteColor(snapshot, 14, 12, 4) ?? primary,
      markdownLink: pickPaletteColor(snapshot, 12, 4) ?? primary,
      markdownLinkText: pickPaletteColor(snapshot, 14, 6) ?? accent,
      markdownCode: pickPaletteColor(snapshot, 10, 2) ?? success,
      markdownBlockQuote: pickPaletteColor(snapshot, 11, 3) ?? warning,
      markdownEmph: pickPaletteColor(snapshot, 11, 3) ?? warning,
      markdownStrong: pickPaletteColor(snapshot, 12, 4) ?? primary,
      markdownHorizontalRule: textMuted,
      markdownListItem: pickPaletteColor(snapshot, 12, 4) ?? primary,
      markdownListEnumeration: pickPaletteColor(snapshot, 14, 6) ?? accent,
      markdownImage: pickPaletteColor(snapshot, 12, 4) ?? primary,
      markdownImageText: pickPaletteColor(snapshot, 14, 6) ?? accent,
      markdownCodeBlock: text,
      syntaxComment: textMuted,
      syntaxKeyword: pickPaletteColor(snapshot, 12, 4) ?? primary,
      syntaxFunction: pickPaletteColor(snapshot, 14, 6) ?? accent,
      syntaxVariable: pickPaletteColor(snapshot, 9, 1) ?? error,
      syntaxString: pickPaletteColor(snapshot, 10, 2) ?? success,
      syntaxNumber: pickPaletteColor(snapshot, 11, 3) ?? warning,
      syntaxType: pickPaletteColor(snapshot, 14, 6, 12, 4) ?? info,
      syntaxOperator: text,
      syntaxPunctuation: text,
      thinkingOpacity: 0.6,
    },
  }
}
