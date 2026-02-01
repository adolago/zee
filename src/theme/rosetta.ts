/**
 * Rosetta Stone Color System v3.0.0
 *
 * SINGLE SOURCE OF TRUTH for all colors in agent-core.
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
  surface: { hex: "#0A3A47", rgb: [10, 58, 71], ansi: "bright_black", color256: 237 },
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
    secondary: { hex: "#5078C2", rgb: [80, 120, 194], ansi: "blue", color256: 68 },
    accent: { hex: "#4D8AFF", rgb: [77, 138, 255], ansi: "bright_blue", color256: 111 },
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

const NO_COLOR = !!process.env.NO_COLOR;

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
// TUI Theme JSON Generator (for theme.tsx consumption)
// =============================================================================

export function generateTuiTheme(personaId: PersonaId) {
  const persona = personaPalettes[personaId];
  return {
    primary: persona.primary.hex,
    secondary: persona.secondary.hex,
    accent: persona.accent.hex,
    error: semantic.error.hex,
    warning: semantic.warning.hex,
    success: semantic.success.hex,
    info: semantic.info.hex,
    text: semantic.text.hex,
    textMuted: semantic.textMuted.hex,
    background: semantic.background.hex,
    backgroundPanel: semantic.backgroundSecondary.hex,
    backgroundElement: semantic.surface.hex,
    border: persona.border.hex,
    borderActive: persona.primary.hex,
    borderSubtle: semantic.surface.hex,
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
