/**
 * Rosetta Stone Color System v3.0.0
 *
 * SINGLE SOURCE OF TRUTH for all colors in zee.
 *
 * Design:
 * - Solarized Dark base palette (professional, WCAG AA compliant)
 * - Persona-specific primaries (Zee=Blue, Stanley=Green, Johny=Red)
 * - Unified semantic colors across all personas
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
// Unified Semantic Colors (SAME for all personas)
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
// Persona-Specific Primary Colors
// =============================================================================

export type PersonaId = "zee" | "stanley" | "johny";

export interface PersonaPalette {
  primary: ColorSpec;
  primaryBright: ColorSpec;
  primaryDim: ColorSpec;
  secondary: ColorSpec;
  accent: ColorSpec;
  border: ColorSpec;
  glow: ColorSpec;
}

export const personaPalettes: Record<PersonaId, PersonaPalette> = {
  zee: {
    primary: solarized.blue,
    primaryBright: { hex: "#69c3ff", rgb: [105, 195, 255], ansi: "bright_blue", color256: 111 },
    primaryDim: { hex: "#1a6094", rgb: [26, 96, 148], ansi: "blue", color256: 24 },
    secondary: { hex: "#5078c2", rgb: [80, 120, 194], ansi: "blue", color256: 68 },
    accent: { hex: "#4d8aff", rgb: [77, 138, 255], ansi: "bright_blue", color256: 111 },
    border: { hex: "#1a6094", rgb: [26, 96, 148], ansi: "blue", color256: 24 },
    glow: { hex: "#69c3ff", rgb: [105, 195, 255], ansi: "bright_blue", color256: 111 },
  },
  stanley: {
    primary: solarized.green,
    primaryBright: { hex: "#b3d900", rgb: [179, 217, 0], ansi: "bright_green", color256: 148 },
    primaryDim: { hex: "#5a6600", rgb: [90, 102, 0], ansi: "green", color256: 58 },
    secondary: { hex: "#6a7a00", rgb: [106, 122, 0], ansi: "green", color256: 58 },
    accent: { hex: "#9acd00", rgb: [154, 205, 0], ansi: "bright_green", color256: 148 },
    border: { hex: "#5a6600", rgb: [90, 102, 0], ansi: "green", color256: 58 },
    glow: { hex: "#b3d900", rgb: [179, 217, 0], ansi: "bright_green", color256: 148 },
  },
  johny: {
    primary: solarized.red,
    primaryBright: { hex: "#ff6b6b", rgb: [255, 107, 107], ansi: "bright_red", color256: 203 },
    primaryDim: { hex: "#9a2422", rgb: [154, 36, 34], ansi: "red", color256: 124 },
    secondary: { hex: "#b52b28", rgb: [181, 43, 40], ansi: "red", color256: 160 },
    accent: { hex: "#ff4d4d", rgb: [255, 77, 77], ansi: "bright_red", color256: 203 },
    border: { hex: "#9a2422", rgb: [154, 36, 34], ansi: "red", color256: 124 },
    glow: { hex: "#ff6b6b", rgb: [255, 107, 107], ansi: "bright_red", color256: 203 },
  },
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

  // Persona primaries
  zee: ansiFromRgb(personaPalettes.zee.primary.rgb),
  stanley: ansiFromRgb(personaPalettes.stanley.primary.rgb),
  johny: ansiFromRgb(personaPalettes.johny.primary.rgb),

  // Persona brights (for highlights)
  zeeBright: ansiFromRgb(personaPalettes.zee.primaryBright.rgb),
  stanleyBright: ansiFromRgb(personaPalettes.stanley.primaryBright.rgb),
  johnyBright: ansiFromRgb(personaPalettes.johny.primaryBright.rgb),

  // Background
  bg: ansiBgFromRgb(semantic.background.rgb),
} as const;

/** Persona CLI colors (compatible with existing personaColors export) */
export const personaCliColors = {
  zee: {
    logo: cliColors.zee,
    primary: cliColors.zee,
    bright: cliColors.zeeBright,
  },
  stanley: {
    logo: cliColors.stanley,
    primary: cliColors.stanley,
    bright: cliColors.stanleyBright,
  },
  johny: {
    logo: cliColors.johny,
    primary: cliColors.johny,
    bright: cliColors.johnyBright,
  },
} as const;

// =============================================================================
// Full Theme Export (for TUI consumption)
// =============================================================================

export interface FullTheme {
  persona: PersonaPalette;
  semantic: typeof semantic;
  solarized: typeof solarized;
}

export function getTheme(personaId: PersonaId): FullTheme {
  return {
    persona: personaPalettes[personaId],
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
// TUI Persona Theme Generator (for theme.tsx consumption)
// =============================================================================

type DarkLight = { dark: string; light: string };
function dl(dark: string, light: string): DarkLight {
  return { dark, light };
}

export function generateTuiPersonaTheme(personaId: PersonaId) {
  const p = personaPalettes[personaId];
  const d = darkColors;
  const l = lightColors;

  // Per-persona personality overrides
  const isStanley = personaId === "stanley";
  const isJohny = personaId === "johny";

  return {
    defs: {
      [`${personaId}Primary`]: p.primary.hex,
      [`${personaId}PrimaryBright`]: p.primaryBright.hex,
      [`${personaId}PrimaryDim`]: p.primaryDim.hex,
      [`${personaId}Secondary`]: p.secondary.hex,
      [`${personaId}Accent`]: p.accent.hex,
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
      primary: dl(`${personaId}Primary`, `${personaId}PrimaryDim`),
      secondary: dl(`${personaId}Secondary`, `${personaId}PrimaryDim`),
      accent: dl(`${personaId}Accent`, `${personaId}Primary`),
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
      borderActive: dl(`${personaId}Primary`, `${personaId}PrimaryDim`),
      borderSubtle: dl("darkBorderSubtle", "lightBorderSubtle"),
      diffAdded: dl("darkGreen", "lightGreen"),
      diffRemoved: dl(
        isJohny ? `${personaId}Primary` : "darkRed",
        isJohny ? `${personaId}PrimaryDim` : "lightRed",
      ),
      diffContext: dl("darkTextMuted", "lightTextMuted"),
      diffHunkHeader: dl("darkTextMuted", "lightTextMuted"),
      diffHighlightAdded: dl(
        isStanley ? `${personaId}Accent` : "darkSyntaxGreen",
        isStanley ? `${personaId}Primary` : "lightSyntaxGreen",
      ),
      diffHighlightRemoved: dl(
        isJohny ? `${personaId}Accent` : "darkRed",
        isJohny ? `${personaId}Primary` : "lightRed",
      ),
      diffAddedBg: dl("transparent", "transparent"),
      diffRemovedBg: dl("transparent", "transparent"),
      diffContextBg: dl("transparent", "transparent"),
      diffLineNumber: dl("darkTextMuted", "lightTextMuted"),
      diffAddedLineNumberBg: dl("transparent", "transparent"),
      diffRemovedLineNumberBg: dl("transparent", "transparent"),
      markdownText: dl("darkText", "lightText"),
      markdownHeading: dl(`${personaId}Primary`, `${personaId}PrimaryDim`),
      markdownLink: dl(`${personaId}Secondary`, `${personaId}PrimaryDim`),
      markdownLinkText: dl(`${personaId}Accent`, `${personaId}Primary`),
      markdownCode: dl(
        isStanley ? `${personaId}Accent` : "darkSyntaxGreen",
        isStanley ? `${personaId}Primary` : "lightSyntaxGreen",
      ),
      markdownBlockQuote: dl(
        isJohny ? `${personaId}PrimaryDim` : "darkTextMuted",
        isJohny ? `${personaId}PrimaryDim` : "lightYellow",
      ),
      markdownEmph: dl(
        isJohny ? `${personaId}Accent` : "darkYellow",
        isJohny ? `${personaId}PrimaryDim` : "lightYellow",
      ),
      markdownStrong: dl(`${personaId}Accent`, `${personaId}Primary`),
      markdownHorizontalRule: dl("darkTextMuted", "lightTextMuted"),
      markdownListItem: dl(`${personaId}Secondary`, `${personaId}PrimaryDim`),
      markdownListEnumeration: dl(`${personaId}Accent`, `${personaId}Primary`),
      markdownImage: dl(`${personaId}Secondary`, `${personaId}PrimaryDim`),
      markdownImageText: dl(`${personaId}Accent`, `${personaId}Primary`),
      markdownCodeBlock: dl("darkText", "lightText"),
      syntaxComment: dl("darkTextMuted", "lightTextMuted"),
      syntaxKeyword: dl(`${personaId}Primary`, `${personaId}PrimaryDim`),
      syntaxFunction: dl(`${personaId}Accent`, `${personaId}Primary`),
      syntaxVariable: dl(
        isJohny ? `${personaId}Accent` : "darkRed",
        isJohny ? `${personaId}Primary` : "lightRed",
      ),
      syntaxString: dl(
        isStanley ? `${personaId}Accent` : "darkSyntaxGreen",
        isStanley ? `${personaId}Primary` : "lightSyntaxGreen",
      ),
      syntaxNumber: dl(
        isJohny ? `${personaId}PrimaryDim` : "darkOrange",
        isJohny ? `${personaId}PrimaryDim` : "lightOrange",
      ),
      syntaxType: dl(
        isJohny ? `${personaId}Accent` : "darkYellow",
        isJohny ? `${personaId}Primary` : "lightYellow",
      ),
      syntaxOperator: dl("darkCyan", "lightCyan"),
      syntaxPunctuation: dl("darkText", "lightText"),
    },
  };
}

// =============================================================================
// Desktop (Web UI) Persona Theme Generator
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

const personaNames: Record<PersonaId, string> = {
  zee: "Zee",
  stanley: "Stanley",
  johny: "Johny",
};

export function generateDesktopPersonaTheme(personaId: PersonaId): DesktopTheme {
  const p = personaPalettes[personaId];
  const d = darkColors;
  const l = lightColors;

  const isStanley = personaId === "stanley";
  const isJohny = personaId === "johny";

  const lightOverrides: Record<string, string> = {
    "text-base": l.text,
    "text-weak": l.textMuted,
    "text-strong": l.text,
    "border-weak-base": l.borderSubtle,
    "markdown-heading": "var(--text-interactive-base)",
    "markdown-text": "var(--text-base)",
    "markdown-link": "var(--text-interactive-base)",
    "markdown-link-text": "var(--text-interactive-base)",
    "markdown-code": isStanley ? l.syntaxGreen : l.syntaxGreen,
    "markdown-block-quote": "var(--text-weak)",
    "markdown-emph": isJohny ? "var(--text-interactive-base)" : "var(--syntax-type)",
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
    "syntax-variable": isJohny ? "var(--syntax-critical)" : "var(--syntax-critical)",
    "syntax-property": "var(--text-interactive-base)",
    "syntax-type": isJohny ? "var(--text-interactive-base)" : l.yellow,
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
    "markdown-code": isStanley ? "var(--text-interactive-base)" : d.syntaxGreen,
    "markdown-block-quote": "var(--text-weak)",
    "markdown-emph": isJohny ? "var(--text-interactive-base)" : "var(--syntax-type)",
    "markdown-strong": "var(--text-interactive-base)",
    "markdown-horizontal-rule": "var(--text-weak)",
    "markdown-list-item": "var(--surface-brand-base)",
    "markdown-list-enumeration": "var(--text-interactive-base)",
    "markdown-image": "var(--surface-brand-base)",
    "markdown-image-text": "var(--text-interactive-base)",
    "markdown-code-block": "var(--text-base)",
    "syntax-comment": "var(--text-weak)",
    "syntax-keyword": "var(--surface-brand-base)",
    "syntax-string": isStanley ? "var(--text-interactive-base)" : d.syntaxGreen,
    "syntax-variable": isJohny ? "var(--text-interactive-base)" : "var(--syntax-critical)",
    "syntax-property": "var(--text-interactive-base)",
    "syntax-type": isJohny ? "var(--text-interactive-base)" : d.yellow,
    "syntax-constant": d.cyan,
    "syntax-punctuation": "var(--text-base)",
    "syntax-operator": d.cyan,
    "syntax-primitive": isJohny ? "var(--text-interactive-base)" : d.orange,
  };

  return {
    $schema: "https://zee-bot.com/desktop-theme.json",
    name: personaNames[personaId],
    id: personaId,
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
  "#FF5A2D": personaPalettes.zee.primary.hex,
  "#FF7A3D": personaPalettes.zee.primaryBright.hex,
  "#F6C453": semantic.highlight.hex,

  // Old "Stealth Matte" persona colors -> Solarized equivalents
  "#3F5E99": personaPalettes.zee.primary.hex,
  "#458A5C": personaPalettes.stanley.primary.hex,
  "#9E4D42": personaPalettes.johny.primary.hex,

  // Old backgrounds -> Unified Solarized
  "#0A0A0A": semantic.background.hex,
  "#121212": semantic.background.hex,
} as const;
