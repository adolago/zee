/**
 * Unified Style System for agent-core CLI
 *
 * Single source of truth for all styling, colors, symbols, and formatting
 * in the CLI interface. This module provides:
 *
 * - ANSI color constants (with NO_COLOR support)
 * - Unicode/ASCII symbols with automatic fallback
 * - Message formatters for consistent output
 * - Typography standards and utilities
 * - Status bar constants
 * - Persona-specific color mappings
 * - Border/box drawing helpers
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Style, Symbols, Message, UI } from "@/cli";
 *
 * // Use semantic colors
 * console.log(`${Style.success}Success!${Style.reset}`);
 *
 * // Use symbols (auto Unicode/ASCII)
 * console.log(`${Symbols.check} Done`);
 *
 * // Format messages
 * console.log(Message.success("Task completed"));
 * ```
 *
 * ## NO_COLOR Support
 *
 * This module fully supports the NO_COLOR standard (https://no-color.org/):
 *
 * ```bash
 * # Disable all colors
 * NO_COLOR=1 agent-core status
 *
 * # Force colors (even when not a TTY)
 * FORCE_COLOR=1 agent-core status | cat
 * ```
 *
 * When NO_COLOR is set:
 * - All ANSI color codes become empty strings
 * - Symbols fall back to ASCII equivalents
 * - Visual output is plain text only
 *
 * ## Unicode vs ASCII
 *
 * Symbols automatically adapt based on terminal capabilities:
 *
 * ```typescript
 * // Unicode (preferred):  ✓ ✗ → … • │ ─
 * // ASCII (fallback):     [OK] [X] -> ... * | -
 * ```
 *
 * Control via environment:
 * ```bash
 * FORCE_UNICODE=1    # Force Unicode
 * NO_UNICODE=1       # Force ASCII
 * ASCII_ONLY=1       # Force ASCII (alias)
 * ```
 *
 * ## Semantic Colors
 *
 * Prefer semantic colors over raw ANSI:
 *
 * ```typescript
 * // Good - semantic
 * console.log(`${Style.success}Done${Style.reset}`);
 * console.log(`${Style.warning}Caution${Style.reset}`);
 * console.log(`${Style.error}Failed${Style.reset}`);
 * console.log(`${Style.info}Note${Style.reset}`);
 *
 * // Okay when needed - raw ANSI via Style.ansi
 * console.log(`${Style.ansi.cyan}Custom${Style.reset}`);
 * ```
 *
 * ## Persona Colors
 *
 * Each persona has themed colors:
 *
 * ```typescript
 * import { personaColors } from "@/cli";
 *
 * console.log(`${personaColors.zee.logo}Zee${Style.reset}`);
 * console.log(`${personaColors.stanley.logo}Stanley${Style.reset}`);
 * console.log(`${personaColors.johny.logo}Johny${Style.reset}`);
 * ```
 *
 * @module
 */

import { env } from "node:process";
import { cliColors, personaCliColors } from "@root/theme/rosetta";

// =============================================================================
// NO_COLOR Detection
// =============================================================================

/**
 * Determine if colors should be used based on environment variables and TTY status.
 *
 * Priority:
 * 1. NO_COLOR - if set (any value), disable colors
 * 2. FORCE_COLOR - if set, enable colors
 * 3. TTY detection - enable if stderr is a TTY
 *
 * @returns true if colors should be used, false otherwise
 *
 * @example
 * ```typescript
 * if (shouldUseColors()) {
 *   console.log("\x1b[32mGreen text\x1b[0m");
 * } else {
 *   console.log("Plain text");
 * }
 * ```
 */
export function shouldUseColors(): boolean {
  // NO_COLOR takes precedence - any value disables colors
  if (env.NO_COLOR !== undefined) return false;
  // FORCE_COLOR explicitly enables colors
  if (env.FORCE_COLOR !== undefined) return true;
  // Default to TTY detection
  return process.stderr.isTTY ?? false;
}

/**
 * Determine if Unicode characters should be used.
 *
 * When NO_COLOR is set, defaults to ASCII for consistent plain-text output.
 *
 * Priority:
 * 1. NO_COLOR - if set, prefer ASCII
 * 2. NO_UNICODE or ASCII_ONLY - if set, use ASCII
 * 3. FORCE_UNICODE - if set, use Unicode
 * 4. LANG/TERM detection - UTF-8 or 256color/truecolor
 * 5. Platform detection - Windows Terminal/VS Code vs plain cmd.exe
 *
 * @returns true if Unicode symbols should be used, false for ASCII
 *
 * @example
 * ```typescript
 * const check = shouldUseUnicode() ? "✓" : "[OK]";
 * console.log(`${check} Task done`);
 * ```
 */
export function shouldUseUnicode(): boolean {
  // NO_COLOR often indicates desire for plain text - use ASCII
  if (env.NO_COLOR !== undefined) return false;
  // Check for explicit Unicode disable
  if (env.NO_UNICODE || env.ASCII_ONLY) return false;
  // Check for explicit Unicode force
  if (env.FORCE_UNICODE) return true;
  // Check for UTF-8 locale
  if (env.LANG?.includes("UTF-8") || env.LANG?.includes("utf8")) return true;
  // Check terminal capabilities
  if (env.TERM?.includes("256color") || env.TERM?.includes("truecolor")) return true;
  // Default to ASCII on Windows unless in Windows Terminal or VS Code
  if (process.platform === "win32") {
    return env.WT_SESSION !== undefined || env.TERM_PROGRAM === "vscode";
  }
  return true;
}

/** Cached color support flag */
const _useColors = shouldUseColors();
/** Cached Unicode support flag */
const _useUnicode = shouldUseUnicode();

// =============================================================================
// ANSI Color Codes (Standard 16-color palette)
// =============================================================================

/**
 * ANSI color codes - returns empty strings when colors are disabled.
 *
 * This allows safe string interpolation:
 * ```typescript
 * `${ANSI.red}text${ANSI.reset}`  // Works with or without colors
 * ```
 *
 * When NO_COLOR is set, all values are empty strings.
 */
const ANSI = _useColors
  ? ({
      // Reset
      reset: "\x1b[0m",

      // Styles
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      italic: "\x1b[3m",
      underline: "\x1b[4m",

      // Standard colors (non-bright for consistency)
      black: "\x1b[30m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      white: "\x1b[37m",

      // Bright colors
      brightBlack: "\x1b[90m",
      brightRed: "\x1b[91m",
      brightGreen: "\x1b[92m",
      brightYellow: "\x1b[93m",
      brightBlue: "\x1b[94m",
      brightMagenta: "\x1b[95m",
      brightCyan: "\x1b[96m",
      brightWhite: "\x1b[97m",
    } as const)
  : ({
      // No-color fallback: all codes are empty strings
      reset: "",
      bold: "",
      dim: "",
      italic: "",
      underline: "",
      black: "",
      red: "",
      green: "",
      yellow: "",
      blue: "",
      magenta: "",
      cyan: "",
      white: "",
      brightBlack: "",
      brightRed: "",
      brightGreen: "",
      brightYellow: "",
      brightBlue: "",
      brightMagenta: "",
      brightCyan: "",
      brightWhite: "",
    } as const);

// =============================================================================
// Semantic Colors
// =============================================================================

/**
 * Unified semantic color constants for CLI output.
 *
 * Combines legacy TEXT_* constants with new semantic names for consistency.
 *
 * @example
 * ```typescript
 * import { Style } from "@/cli";
 *
 * // Semantic status colors
 * console.log(`${Style.success}✓ Success${Style.reset}`);
 * console.log(`${Style.warning}⚠ Warning${Style.reset}`);
 * console.log(`${Style.error}✗ Error${Style.reset}`);
 * console.log(`${Style.info}ℹ Info${Style.reset}`);
 *
 * // Utility styles
 * console.log(`${Style.muted}Dimmed text${Style.reset}`);
 * console.log(`${Style.bold}Bold text${Style.reset}`);
 *
 * // Direct ANSI access
 * console.log(`${Style.ansi.cyan}Cyan${Style.reset}`);
 *
 * // Theme colors
 * console.log(`${Style.theme.border}Border${Style.reset}`);
 * ```
 */
export const Style = {
  // Semantic status colors (new)
  success: ANSI.green,
  successBold: `${ANSI.green}${ANSI.bold}`,

  warning: ANSI.yellow,
  warningBold: `${ANSI.yellow}${ANSI.bold}`,

  error: ANSI.red,
  errorBold: `${ANSI.red}${ANSI.bold}`,

  info: ANSI.blue,
  infoBold: `${ANSI.blue}${ANSI.bold}`,

  // Utility styles (new)
  muted: ANSI.brightBlack,
  mutedBold: `${ANSI.brightBlack}${ANSI.bold}`,

  dim: ANSI.dim,
  bold: ANSI.bold,
  reset: ANSI.reset,

  // ANSI palette access (new)
  ansi: ANSI,

  // Theme-mapped colors for TUI-like styling in CLI
  theme: {
    border: ANSI.brightBlack,
    text: ANSI.white,
    textMuted: ANSI.brightBlack,
    textHighlight: ANSI.brightCyan,
    primary: ANSI.blue,
    success: ANSI.green,
    warning: ANSI.yellow,
    error: ANSI.red,
  },

  // Legacy aliases (for backward compatibility with existing code)
  TEXT_HIGHLIGHT: ANSI.brightCyan,
  TEXT_HIGHLIGHT_BOLD: `${ANSI.brightCyan}${ANSI.bold}`,
  TEXT_DIM: ANSI.brightBlack,
  TEXT_DIM_BOLD: `${ANSI.brightBlack}${ANSI.bold}`,
  TEXT_NORMAL: ANSI.reset,
  TEXT_NORMAL_BOLD: ANSI.bold,
  TEXT_WARNING: ANSI.brightYellow,
  TEXT_WARNING_BOLD: `${ANSI.brightYellow}${ANSI.bold}`,
  TEXT_DANGER: ANSI.brightRed,
  TEXT_DANGER_BOLD: `${ANSI.brightRed}${ANSI.bold}`,
  TEXT_SUCCESS: ANSI.brightGreen,
  TEXT_SUCCESS_BOLD: `${ANSI.brightGreen}${ANSI.bold}`,
  TEXT_INFO: ANSI.brightBlue,
  TEXT_INFO_BOLD: `${ANSI.brightBlue}${ANSI.bold}`,
} as const;

// =============================================================================
// Symbols (Unicode/ASCII variants)
// =============================================================================

/**
 * Terminal symbols with automatic Unicode/ASCII fallback.
 *
 * When Unicode is available (default), uses elegant Unicode symbols.
 * Falls back to ASCII equivalents for limited terminals or when NO_COLOR is set.
 *
 * @example
 * ```typescript
 * import { Symbols } from "@/cli";
 *
 * // Status indicators
 * console.log(`${Symbols.check} Task done`);
 * console.log(`${Symbols.cross} Failed`);
 * console.log(`${Symbols.warning} Caution`);
 *
 * // Box drawing
 * console.log(`${Symbols.cornerTL}${Symbols.hLine.repeat(10)}${Symbols.cornerTR}`);
 * console.log(`${Symbols.vLine} Content  ${Symbols.vLine}`);
 * console.log(`${Symbols.cornerBL}${Symbols.hLine.repeat(10)}${Symbols.cornerBR}`);
 *
 * // Spinner frames
 * let frame = 0;
 * setInterval(() => {
 *   process.stdout.write(`\r${Symbols.spinner[frame++ % Symbols.spinner.length]} Loading...`);
 * }, 60);
 * ```
 */
export const Symbols = {
  // Status indicators (resolved strings)
  check: _useUnicode ? "✓" : "[OK]",
  cross: _useUnicode ? "✗" : "[X]",
  warning: _useUnicode ? "⚠" : "[!]",
  info: _useUnicode ? "ℹ" : "[i]",
  question: _useUnicode ? "?" : "?",
  bullet: _useUnicode ? "•" : "*",
  arrow: _useUnicode ? "→" : "->",
  ellipsis: _useUnicode ? "…" : "...",

  // Box drawing
  hLine: _useUnicode ? "─" : "-",
  vLine: _useUnicode ? "│" : "|",
  hDoubleLine: _useUnicode ? "═" : "=",
  vDoubleLine: _useUnicode ? "║" : "|",
  cornerTL: _useUnicode ? "┌" : "+",
  cornerTR: _useUnicode ? "┐" : "+",
  cornerBL: _useUnicode ? "└" : "+",
  cornerBR: _useUnicode ? "┘" : "+",

  // Progress indicators
  spinner: _useUnicode
    ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    : ["|", "/", "-", "\\"],

  // Special
  star: _useUnicode ? "★" : "*",
  gear: _useUnicode ? "⚙" : "[settings]",

  // Symbol definitions (for getSymbol function compatibility)
  success: { unicode: "✓", ascii: "[OK]" },
  error: { unicode: "✗", ascii: "[ERR]" },
  pending: { unicode: "◐", ascii: "[...]" },
  circle: { unicode: "○", ascii: "o" },
  diamond: { unicode: "◆", ascii: "[+]" },
  blocked: { unicode: "⊘", ascii: "[X]" },
} as const;

/**
 * Get the appropriate symbol based on terminal capabilities.
 *
 * Uses Unicode by default, falls back to ASCII if needed.
 *
 * @param name - Symbol name from Symbols object
 * @param useUnicode - Force Unicode (true) or ASCII (false)
 * @returns Symbol string
 *
 * @example
 * ```typescript
 * import { getSymbol } from "@/cli";
 *
 * console.log(getSymbol("check"));      // ✓ or [OK]
 * console.log(getSymbol("check", true)); // ✓
 * console.log(getSymbol("check", false)); // [OK]
 * ```
 *
 * @deprecated Use Symbols.* directly for resolved values
 */
export function getSymbol(name: keyof typeof Symbols, useUnicode = true): string {
  const symbol = Symbols[name];
  if (typeof symbol === "string") {
    return symbol;
  }
  if (Array.isArray(symbol)) {
    return symbol[0];
  }
  if (symbol && typeof symbol === "object" && "unicode" in symbol) {
    return useUnicode ? symbol.unicode : symbol.ascii;
  }
  return String(symbol);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Wrap text with color codes.
 *
 * @param text - Text to colorize
 * @param colorCode - ANSI color code
 * @returns Colorized text with reset
 *
 * @example
 * ```typescript
 * import { color, Style } from "@/cli";
 *
 * console.log(color("Important!", Style.error));
 * console.log(color("Done", Style.success));
 * ```
 */
export function color(text: string, colorCode: string): string {
  return `${colorCode}${text}${Style.reset}`;
}

/**
 * Wrap text with semantic success color.
 *
 * @param text - Text to colorize
 * @returns Green-colored text
 */
export function success(text: string): string {
  return color(text, Style.success);
}

/**
 * Wrap text with semantic warning color.
 *
 * @param text - Text to colorize
 * @returns Yellow-colored text
 */
export function warning(text: string): string {
  return color(text, Style.warning);
}

/**
 * Wrap text with semantic error color.
 *
 * @param text - Text to colorize
 * @returns Red-colored text
 */
export function error(text: string): string {
  return color(text, Style.error);
}

/**
 * Wrap text with semantic info color.
 *
 * @param text - Text to colorize
 * @returns Blue-colored text
 */
export function info(text: string): string {
  return color(text, Style.info);
}

/**
 * Wrap text with muted/gray color.
 *
 * @param text - Text to colorize
 * @returns Gray-colored text
 */
export function muted(text: string): string {
  return color(text, Style.muted);
}

/**
 * Wrap text with dim style.
 *
 * @param text - Text to style
 * @returns Dimmed text
 */
export function dim(text: string): string {
  return color(text, Style.dim);
}

/**
 * Wrap text with bold style.
 *
 * @param text - Text to style
 * @returns Bold text
 */
export function bold(text: string): string {
  return color(text, Style.bold);
}

/**
 * Strip ANSI codes from text.
 *
 * @param text - Text that may contain ANSI codes
 * @returns Plain text without ANSI codes
 *
 * @example
 * ```typescript
 * import { stripAnsi } from "@/cli";
 *
 * const colored = "\x1b[32mGreen\x1b[0m";
 * console.log(stripAnsi(colored)); // "Green"
 * ```
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Get the visual width of a string (accounting for ANSI codes).
 *
 * @param text - Text to measure
 * @returns Visible character count
 *
 * @example
 * ```typescript
 * import { visualWidth } from "@/cli";
 *
 * const colored = "\x1b[32mHello\x1b[0m";
 * console.log(visualWidth(colored)); // 5 (not 13)
 * ```
 */
export function visualWidth(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Pad a string to a specific visual width.
 *
 * Accounts for ANSI codes so padding is correct even with colored text.
 *
 * @param str - String to pad
 * @param width - Target visual width
 * @param fill - Fill character (default: space)
 * @returns Padded string
 */
export function padEnd(str: string, width: number, fill = " "): string {
  const strWidth = visualWidth(str);
  if (strWidth >= width) return str;
  return str + fill.repeat(width - strWidth);
}

// =============================================================================
// Status Bar Constants
// =============================================================================

/**
 * Status bar layout constants.
 *
 * @example
 * ```typescript
 * import { StatusBar, Style } from "@/cli";
 *
 * const left = "Status: Ready";
 * const right = "v1.0.0";
 * console.log(`${left}${StatusBar.separator}${Style.muted}${right}${Style.reset}`);
 * ```
 */
export const StatusBar = {
  /** Separator with spaces ( │ ) */
  separator: " │ ",
  /** Inner separator without spaces for tight groupings (│) */
  innerSeparator: "│",
} as const;

// =============================================================================
// Message Formatting Utilities
// =============================================================================

/**
 * Standardized message formatters with icons and colors.
 *
 * Single source of truth for CLI message display.
 *
 * @example
 * ```typescript
 * import { Message } from "@/cli";
 *
 * console.log(Message.success("Task completed"));
 * console.log(Message.error("Connection failed"));
 * console.log(Message.warning("Disk space low"));
 * console.log(Message.info("Processing..."));
 * ```
 */
export const Message = {
  /** Success message with checkmark icon and green color */
  success: (text: string) => color(`${Symbols.check} ${text}`, Style.success),
  /** Error message with cross icon and red color */
  error: (text: string) => color(`${Symbols.cross} ${text}`, Style.error),
  /** Warning message with warning icon and yellow color */
  warning: (text: string) => color(`${Symbols.warning} ${text}`, Style.warning),
  /** Info message with info icon and blue color */
  info: (text: string) => color(`${Symbols.info} ${text}`, Style.info),
} as const;

// =============================================================================
// Theme to ANSI Mapping
// =============================================================================

/**
 * Map RGB hex color to closest ANSI color code.
 *
 * When NO_COLOR is set, returns empty string.
 *
 * @internal
 */
function rgbToAnsi(r: number, g: number, b: number): string {
  if (!_useColors) return "";

  // Use 24-bit color if supported
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Convert hex color to ANSI escape code.
 *
 * When NO_COLOR is set, returns empty string.
 *
 * @internal
 */
function _hexToAnsi(hex: string): string {
  if (!_useColors) return "";

  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return rgbToAnsi(r, g, b);
}

/**
 * Theme to ANSI color mapping for CLI mode.
 *
 * Maps theme color names to ANSI escape codes.
 * When NO_COLOR is set, all values are empty strings.
 *
 * @example
 * ```typescript
 * import { themeToAnsi } from "@/cli";
 *
 * console.log(`${themeToAnsi.success}Success${Style.reset}`);
 * console.log(`${themeToAnsi.error}Error${Style.reset}`);
 * ```
 */
export const themeToAnsi = {
  primary: _useColors ? "\x1b[96m" : "", // Cyan
  secondary: _useColors ? "\x1b[95m" : "", // Magenta
  accent: _useColors ? "\x1b[96m" : "", // Cyan
  error: cliColors.error,
  warning: cliColors.warning,
  success: cliColors.success,
  info: cliColors.info,
  muted: cliColors.muted,
  text: cliColors.text,
  background: "",
  border: cliColors.muted,
} as const;

/**
 * Persona-specific colors for CLI mode.
 *
 * Each persona (Zee, Stanley, Johny) has unique brand colors
 * that map to the closest ANSI equivalent.
 *
 * When NO_COLOR is set, all values are empty strings.
 *
 * @example
 * ```typescript
 * import { personaColors, Style } from "@/cli";
 *
 * // Zee blue
 * console.log(`${personaColors.zee.logo}Zee${Style.reset}`);
 *
 * // Stanley green
 * console.log(`${personaColors.stanley.logo}Stanley${Style.reset}`);
 *
 * // Johny orange
 * console.log(`${personaColors.johny.logo}Johny${Style.reset}`);
 * ```
 */
export const personaColors = personaCliColors;
