/**
 * Rosetta Stone Color System v3.0.0
 *
 * SINGLE SOURCE OF TRUTH for all colors in zee.
 *
 * Design:
 * - Solarized Dark base palette (professional, WCAG AA compliant)
 * - Zee primary palette
 * - Unified semantic colors across the single-Zee runtime
 *
 * Import from here, not from scattered theme files.
 */

// =============================================================================
// Color Specification Type
// =============================================================================

export interface ColorSpec {
  hex: string;
  rgb: [number, number, number];
  ansi: string;
  color256: number;
}

// =============================================================================
// Solarized Dark Base Palette
// =============================================================================

export const solarized = {
  base03: { hex: "#002b36", rgb: [0, 43, 54], ansi: "black", color256: 234 },
  base02: { hex: "#073642", rgb: [7, 54, 66], ansi: "black", color256: 236 },
  base01: { hex: "#586e75", rgb: [88, 110, 117], ansi: "bright_black", color256: 240 },
  base00: { hex: "#657b83", rgb: [101, 123, 131], ansi: "bright_black", color256: 243 },
  base0: { hex: "#839496", rgb: [131, 148, 150], ansi: "white", color256: 245 },
  base1: { hex: "#93a1a1", rgb: [147, 161, 161], ansi: "bright_white", color256: 247 },
  base2: { hex: "#eee8d5", rgb: [238, 232, 213], ansi: "white", color256: 254 },
  base3: { hex: "#fdf6e3", rgb: [253, 246, 227], ansi: "bright_white", color256: 230 },
  yellow: { hex: "#b58900", rgb: [181, 137, 0], ansi: "yellow", color256: 172 },
  orange: { hex: "#cb4b16", rgb: [203, 75, 22], ansi: "bright_red", color256: 166 },
  red: { hex: "#dc322f", rgb: [220, 50, 47], ansi: "red", color256: 196 },
  magenta: { hex: "#d33682", rgb: [211, 54, 130], ansi: "magenta", color256: 168 },
  violet: { hex: "#6c71c4", rgb: [108, 113, 196], ansi: "bright_magenta", color256: 61 },
  blue: { hex: "#268bd2", rgb: [38, 139, 210], ansi: "blue", color256: 33 },
  cyan: { hex: "#2aa198", rgb: [42, 161, 152], ansi: "cyan", color256: 37 },
  green: { hex: "#859900", rgb: [133, 153, 0], ansi: "green", color256: 64 },
} as const satisfies Record<string, ColorSpec>;

// =============================================================================
// Unified Semantic Colors (shared across Zee and legacy aliases)
// =============================================================================

export const semantic = {
  success: solarized.cyan,
  warning: solarized.yellow,
  error: solarized.red,
  info: solarized.cyan,
  highlight: solarized.magenta,
  background: solarized.base03,
  backgroundSecondary: solarized.base02,
  surface: { hex: "#0a3a47", rgb: [10, 58, 71], ansi: "bright_black", color256: 237 },
  text: solarized.base0,
  textBright: solarized.base1,
  textMuted: solarized.base01,
  textDim: solarized.base00,
  shadow: { hex: "#001419", rgb: [0, 20, 25], ansi: "black", color256: 232 },
} as const satisfies Record<string, ColorSpec>;

// =============================================================================
// Zee Primary Colors
// =============================================================================

export type AssistantId = "zee";

export interface AssistantPalette {
  primary: ColorSpec;
  primaryBright: ColorSpec;
  primaryDim: ColorSpec;
  secondary: ColorSpec;
  accent: ColorSpec;
  border: ColorSpec;
  glow: ColorSpec;
}

const zeePalette: AssistantPalette = {
  primary: solarized.blue,
  primaryBright: { hex: "#69c3ff", rgb: [105, 195, 255], ansi: "bright_blue", color256: 111 },
  primaryDim: { hex: "#1a6094", rgb: [26, 96, 148], ansi: "blue", color256: 24 },
  secondary: { hex: "#5078c2", rgb: [80, 120, 194], ansi: "blue", color256: 68 },
  accent: { hex: "#4d8aff", rgb: [77, 138, 255], ansi: "bright_blue", color256: 111 },
  border: { hex: "#1a6094", rgb: [26, 96, 148], ansi: "blue", color256: 24 },
  glow: { hex: "#69c3ff", rgb: [105, 195, 255], ansi: "bright_blue", color256: 111 },
};

export const assistantPalettes: Record<AssistantId, AssistantPalette> = {
  zee: zeePalette,
} as const;

// =============================================================================
// CLI ANSI Escape Codes (for terminal output)
// =============================================================================

const NO_COLOR = typeof process !== "undefined" && !!process.env?.NO_COLOR;

function ansiFromRgb(rgb: readonly [number, number, number]): string {
  return NO_COLOR ? "" : `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function ansiBgFromRgb(rgb: readonly [number, number, number]): string {
  return NO_COLOR ? "" : `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

export const cliColors = {
  reset: NO_COLOR ? "" : "\x1b[0m",
  bold: NO_COLOR ? "" : "\x1b[1m",
  dim: NO_COLOR ? "" : "\x1b[2m",

  // Semantic
  error: ansiFromRgb(semantic.error.rgb),
  warning: ansiFromRgb(semantic.warning.rgb),
  success: ansiFromRgb(semantic.success.rgb),
  info: ansiFromRgb(semantic.info.rgb),
  muted: ansiFromRgb(semantic.textMuted.rgb),
  text: ansiFromRgb(semantic.text.rgb),

  // Zee primary palette
  zee: ansiFromRgb(assistantPalettes.zee.primary.rgb),

  // Zee bright palette
  zeeBright: ansiFromRgb(assistantPalettes.zee.primaryBright.rgb),

  // Background
  bg: ansiBgFromRgb(semantic.background.rgb),
} as const;

/** Assistant CLI colors */
export const assistantCliColors = {
  zee: {
    logo: cliColors.zee,
    primary: cliColors.zee,
    bright: cliColors.zeeBright,
  },
} as const;

// =============================================================================
// Full Theme Export (for TUI consumption)
// =============================================================================

export interface FullTheme {
  assistant: AssistantPalette;
  semantic: typeof semantic;
  solarized: typeof solarized;
}

export function getTheme(assistantId: AssistantId = "zee"): FullTheme {
  return {
    assistant: assistantPalettes[assistantId],
    semantic,
    solarized,
  };
}

// =============================================================================
// Shared Theme Colors (used by both TUI and Desktop generators)
// =============================================================================

const darkColors = {
  text: "#d4d4d4",
  textMuted: "#808080",
  red: "#f44747",
  yellow: "#e5c07b",
  green: "#73daca",
  cyan: "#56b6c2",
  orange: "#d19a66",
  border: "#4a4a4a",
  borderActive: "#606060",
  borderSubtle: "#333333",
  syntaxGreen: "#98c379",
} as const;

const lightColors = {
  text: "#383a42",
  textMuted: "#a0a1a7",
  red: "#e45649",
  yellow: "#c18401",
  green: "#40a02b",
  cyan: "#0184bc",
  orange: "#986801",
  border: "#d4d4d4",
  borderActive: "#b8b8b8",
  borderSubtle: "#e8e8e8",
  syntaxGreen: "#50a14f",
} as const;

// =============================================================================
// TUI Theme Generator
// =============================================================================

type DarkLight = { dark: string; light: string };
function dl(dark: string, light: string): DarkLight {
  return { dark, light };
}

export function generateTuiAssistantTheme(assistantId: AssistantId = "zee") {
  const id = assistantId;
  const p = assistantPalettes[id];
  const d = darkColors;
  const l = lightColors;

  return {
    defs: {
      [`${id}Primary`]: p.primary.hex,
      [`${id}PrimaryBright`]: p.primaryBright.hex,
      [`${id}PrimaryDim`]: p.primaryDim.hex,
      [`${id}Secondary`]: p.secondary.hex,
      [`${id}Accent`]: p.accent.hex,
      darkText: d.text,
      darkTextMuted: d.textMuted,
      darkRed: d.red,
      darkYellow: d.yellow,
      darkGreen: d.green,
      darkCyan: d.cyan,
      darkOrange: d.orange,
      darkBorder: d.border,
      darkBorderActive: d.borderActive,
      darkBorderSubtle: d.borderSubtle,
      darkSyntaxGreen: d.syntaxGreen,
      lightText: l.text,
      lightTextMuted: l.textMuted,
      lightRed: l.red,
      lightYellow: l.yellow,
      lightGreen: l.green,
      lightCyan: l.cyan,
      lightOrange: l.orange,
      lightBorder: l.border,
      lightBorderActive: l.borderActive,
      lightBorderSubtle: l.borderSubtle,
      lightSyntaxGreen: l.syntaxGreen,
    },
    theme: {
      primary: dl(`${id}Primary`, `${id}PrimaryDim`),
      secondary: dl(`${id}Secondary`, `${id}PrimaryDim`),
      accent: dl(`${id}Accent`, `${id}Primary`),
      error: dl("darkRed", "lightRed"),
      warning: dl("darkYellow", "lightYellow"),
      success: dl("darkGreen", "lightGreen"),
      info: dl("darkCyan", "lightCyan"),
      text: dl("darkText", "lightText"),
      textMuted: dl("darkTextMuted", "lightTextMuted"),
      background: dl("transparent", "transparent"),
      backgroundPanel: dl("transparent", "transparent"),
      backgroundElement: dl("transparent", "transparent"),
      backgroundMenu: dl("transparent", "transparent"),
      border: dl("darkBorder", "lightBorder"),
      borderActive: dl(`${id}Primary`, `${id}PrimaryDim`),
      borderSubtle: dl("darkBorderSubtle", "lightBorderSubtle"),
      diffAdded: dl("darkGreen", "lightGreen"),
      diffRemoved: dl("darkRed", "lightRed"),
      diffContext: dl("darkTextMuted", "lightTextMuted"),
      diffHunkHeader: dl("darkTextMuted", "lightTextMuted"),
      diffHighlightAdded: dl("darkSyntaxGreen", "lightSyntaxGreen"),
      diffHighlightRemoved: dl("darkRed", "lightRed"),
      diffAddedBg: dl("transparent", "transparent"),
      diffRemovedBg: dl("transparent", "transparent"),
      diffContextBg: dl("transparent", "transparent"),
      diffLineNumber: dl("darkTextMuted", "lightTextMuted"),
      diffAddedLineNumberBg: dl("transparent", "transparent"),
      diffRemovedLineNumberBg: dl("transparent", "transparent"),
      markdownText: dl("darkText", "lightText"),
      markdownHeading: dl(`${id}Primary`, `${id}PrimaryDim`),
      markdownLink: dl(`${id}Secondary`, `${id}PrimaryDim`),
      markdownLinkText: dl(`${id}Accent`, `${id}Primary`),
      markdownCode: dl("darkSyntaxGreen", "lightSyntaxGreen"),
      markdownBlockQuote: dl("darkTextMuted", "lightYellow"),
      markdownEmph: dl("darkYellow", "lightYellow"),
      markdownStrong: dl(`${id}Accent`, `${id}Primary`),
      markdownHorizontalRule: dl("darkTextMuted", "lightTextMuted"),
      markdownListItem: dl(`${id}Secondary`, `${id}PrimaryDim`),
      markdownListEnumeration: dl(`${id}Accent`, `${id}Primary`),
      markdownImage: dl(`${id}Secondary`, `${id}PrimaryDim`),
      markdownImageText: dl(`${id}Accent`, `${id}Primary`),
      markdownCodeBlock: dl("darkText", "lightText"),
      syntaxComment: dl("darkTextMuted", "lightTextMuted"),
      syntaxKeyword: dl(`${id}Primary`, `${id}PrimaryDim`),
      syntaxFunction: dl(`${id}Accent`, `${id}Primary`),
      syntaxVariable: dl("darkRed", "lightRed"),
      syntaxString: dl("darkSyntaxGreen", "lightSyntaxGreen"),
      syntaxNumber: dl("darkOrange", "lightOrange"),
      syntaxType: dl("darkYellow", "lightYellow"),
      syntaxOperator: dl("darkCyan", "lightCyan"),
      syntaxPunctuation: dl("darkText", "lightText"),
    },
  };
}

// =============================================================================
// Desktop (Web UI) Theme Generator
// =============================================================================

interface DesktopThemeVariant {
  seeds: {
    neutral: string;
    primary: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    interactive: string;
    diffAdd: string;
    diffDelete: string;
  };
  overrides: Record<string, string>;
}

interface DesktopTheme {
  $schema: string;
  name: string;
  id: string;
  light: DesktopThemeVariant;
  dark: DesktopThemeVariant;
}

const assistantNames: Record<AssistantId, string> = { zee: "Zee" };

export function generateDesktopAssistantTheme(assistantId: AssistantId = "zee"): DesktopTheme {
  const id = assistantId;
  const p = assistantPalettes[id];
  const d = darkColors;
  const l = lightColors;

  const lightOverrides: Record<string, string> = {
    "text-base": l.text,
    "text-weak": l.textMuted,
    "text-strong": l.text,
    "border-weak-base": l.borderSubtle,
    "markdown-heading": "var(--text-interactive-base)",
    "markdown-text": "var(--text-base)",
    "markdown-link": "var(--text-interactive-base)",
    "markdown-link-text": "var(--text-interactive-base)",
    "markdown-code": l.syntaxGreen,
    "markdown-block-quote": "var(--text-weak)",
    "markdown-emph": "var(--syntax-type)",
    "markdown-strong": "var(--text-interactive-base)",
    "markdown-horizontal-rule": "var(--text-weak)",
    "markdown-list-item": "var(--text-interactive-base)",
    "markdown-list-enumeration": "var(--text-interactive-base)",
    "markdown-image": "var(--text-interactive-base)",
    "markdown-image-text": "var(--text-interactive-base)",
    "markdown-code-block": "var(--text-base)",
    "syntax-comment": "var(--text-weak)",
    "syntax-keyword": "var(--text-interactive-base)",
    "syntax-string": l.syntaxGreen,
    "syntax-variable": "var(--syntax-critical)",
    "syntax-property": "var(--text-interactive-base)",
    "syntax-type": l.yellow,
    "syntax-constant": l.cyan,
    "syntax-punctuation": "var(--text-base)",
    "syntax-operator": l.cyan,
  };

  const darkOverrides: Record<string, string> = {
    "background-base": "#0a0a0a",
    "background-weak": "#141414",
    "background-strong": "#1e1e1e",
    "background-stronger": "#282828",
    "surface-base": "#141414",
    "surface-base-hover": "#1e1e1e",
    "surface-raised-base": "#1e1e1e",
    "surface-raised-strong": "#282828",
    "surface-float-base": "#141414",
    "surface-float-base-hover": "#1e1e1e",
    "surface-inset-base": "#0a0a0a",
    "text-base": d.text,
    "text-weak": d.textMuted,
    "text-strong": d.text,
    "border-base": d.border,
    "border-weak-base": d.borderSubtle,
    "border-strong-base": d.borderActive,
    "icon-base": d.textMuted,
    "icon-strong-base": d.text,
    "markdown-heading": "var(--surface-brand-base)",
    "markdown-text": "var(--text-base)",
    "markdown-link": "var(--surface-brand-base)",
    "markdown-link-text": "var(--text-interactive-base)",
    "markdown-code": d.syntaxGreen,
    "markdown-block-quote": "var(--text-weak)",
    "markdown-emph": "var(--syntax-type)",
    "markdown-strong": "var(--text-interactive-base)",
    "markdown-horizontal-rule": "var(--text-weak)",
    "markdown-list-item": "var(--surface-brand-base)",
    "markdown-list-enumeration": "var(--text-interactive-base)",
    "markdown-image": "var(--surface-brand-base)",
    "markdown-image-text": "var(--text-interactive-base)",
    "markdown-code-block": "var(--text-base)",
    "syntax-comment": "var(--text-weak)",
    "syntax-keyword": "var(--surface-brand-base)",
    "syntax-string": d.syntaxGreen,
    "syntax-variable": "var(--syntax-critical)",
    "syntax-property": "var(--text-interactive-base)",
    "syntax-type": d.yellow,
    "syntax-constant": d.cyan,
    "syntax-punctuation": "var(--text-base)",
    "syntax-operator": d.cyan,
    "syntax-primitive": d.orange,
  };

  return {
    $schema: "https://zee.dev/desktop-theme.json",
    name: assistantNames[id],
    id,
    light: {
      seeds: {
        neutral: "#8a8a8a",
        primary: p.primaryDim.hex,
        success: l.green,
        warning: l.yellow,
        error: l.red,
        info: l.cyan,
        interactive: p.primary.hex,
        diffAdd: "#4db380",
        diffDelete: "#d1383d",
      },
      overrides: lightOverrides,
    },
    dark: {
      seeds: {
        neutral: d.textMuted,
        primary: p.primary.hex,
        success: d.green,
        warning: d.yellow,
        error: d.red,
        info: d.cyan,
        interactive: p.accent.hex,
        diffAdd: "#4fd6be",
        diffDelete: "#c53b53",
      },
      overrides: darkOverrides,
    },
  };
}

// =============================================================================
// Migration Helper: Map old colors to new
// =============================================================================

export const migrationMap = {
  // Old Zee orange/yellow (WRONG) -> New blue (CORRECT)
  "#FF5A2D": assistantPalettes.zee.primary.hex,
  "#FF7A3D": assistantPalettes.zee.primaryBright.hex,
  "#F6C453": semantic.highlight.hex,

  // Legacy palette values mapped onto Zee's palette
  "#3F5E99": assistantPalettes.zee.primary.hex,
  "#458A5C": assistantPalettes.zee.primary.hex,
  "#9E4D42": assistantPalettes.zee.primary.hex,

  // Old backgrounds -> Unified Solarized
  "#0A0A0A": semantic.background.hex,
  "#121212": semantic.background.hex,
} as const;
