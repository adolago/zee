/**
 * UI Utilities and Namespace
 *
 * Higher-level UI utilities that build on the style system.
 * Re-exports from style.ts for backward compatibility.
 *
 * ## NO_COLOR Support
 *
 * This module respects the NO_COLOR environment variable (https://no-color.org/).
 * When NO_COLOR is set, all styling is disabled and plain text is returned.
 * The underlying Style and Symbols automatically adapt based on NO_COLOR.
 *
 * ## Backward Compatibility
 *
 * All style exports from `./style` are re-exported through the UI namespace
 * for backward compatibility with existing code.
 *
 * @example
 * ```typescript
 * // Using UI namespace (legacy but supported)
 * import { UI } from "@/cli/ui";
 * UI.success("Task completed");
 * console.log(UI.Style.success + "text" + UI.Style.reset);
 *
 * // Using direct style imports (recommended)
 * import { Style, Symbols, Message, UI } from "@/cli";
 * console.log(`${Style.success}text${Style.reset}`);
 * ```
 */

import z from "zod"
import { EOL } from "os"
import { NamedError } from "@zee/util/error"
import {
  Style as StyleImpl,
  Symbols as SymbolsImpl,
  Message as MessageImpl,
  themeToAnsi as themeToAnsiImpl,
  assistantColors as assistantColorsImpl,
  shouldUseColors as shouldUseColorsImpl,
} from "./style"

// Re-export all style utilities for direct access (backward compatibility)
export {
  Style,
  Symbols,
  Message,
  themeToAnsi,
  assistantColors,
  shouldUseColors,
  shouldUseUnicode,
  color,
  success as successColor,
  warning as warningColor,
  error as errorColor,
  info as infoColor,
  muted,
  dim,
  bold,
  stripAnsi,
  visualWidth,
  padEnd,
  StatusBar,
  getSymbol,
} from "./style"

/**
 * UI namespace providing high-level UI utilities.
 *
 * This namespace provides:
 * - Formatted output methods (success, error, warn, info)
 * - Logo rendering with Zee branding
 * - User input handling
 * - Access to Style, Symbols, and Message through properties
 *
 * @example
 * ```typescript
 * import { UI } from "@/cli/ui";
 *
 * // Print messages
 * UI.success("Operation completed");
 * UI.error("Something went wrong");
 * UI.warn("Please check your configuration");
 * UI.info("Processing...");
 *
 * // Print logo
 * console.log(UI.logo());
 *
 * // Get user input
 * const name = await UI.input("Enter your name: ");
 * ```
 */
export namespace UI {
  // Default Zee logo.
  const LOGO = [
    "███████╗███████╗███████╗",
    "╚══███╔╝██╔════╝██╔════╝",
    "  ███╔╝ █████╗  █████╗  ",
    " ███╔╝  ██╔══╝  ██╔══╝  ",
    "███████╗███████╗███████╗",
    "╚══════╝╚══════╝╚══════╝",
  ]

  /**
   * Error thrown when user cancels an input operation
   */
  export const CancelledError = NamedError.create("UICancelledError", z.void())

  // =============================================================================
  // Re-exports from style.ts (for backward compatibility)
  // =============================================================================

  /**
   * Semantic color constants and ANSI styles
   * @deprecated Use direct import: `import { Style } from "@/cli"`
   */
  export const Style = StyleImpl

  /**
   * Unicode/ASCII symbols with automatic fallback
   * @deprecated Use direct import: `import { Symbols } from "@/cli"`
   */
  export const Symbols = SymbolsImpl

  /**
   * Message formatters with icons
   * @deprecated Use direct import: `import { Message } from "@/cli"`
   */
  export const Message = MessageImpl

  /**
   * Theme to ANSI color mapping
   * @deprecated Use direct import: `import { themeToAnsi } from "@/cli"`
   */
  export const themeToAnsi = themeToAnsiImpl

  /**
   * Persona-specific colors
   * @deprecated Use direct import: `import { assistantColors } from "@/cli"`
   */
  export const assistantColors = assistantColorsImpl

  /**
   * Check if colors should be used
   * @deprecated Use direct import: `import { shouldUseColors } from "@/cli"`
   */
  export const shouldUseColors = shouldUseColorsImpl

  // =============================================================================
  // Output Methods
  // =============================================================================

  /**
   * Print message to stderr with newline
   *
   * @param message - Messages to print
   */
  export function println(...message: string[]) {
    print(...message)
    Bun.stderr.write(EOL)
  }

  /**
   * Print message to stderr without newline
   *
   * @param message - Messages to print
   */
  export function print(...message: string[]) {
    blank = false
    Bun.stderr.write(message.join(" "))
  }

  let blank = false

  /**
   * Print a section header with highlighting
   *
   * @param text - Header text
   */
  export function header(text: string) {
    empty()
    println(StyleImpl.TEXT_HIGHLIGHT_BOLD + text + StyleImpl.TEXT_NORMAL)
    empty()
  }

  /**
   * Print an info message
   *
   * @param text - Message text
   */
  export function info(text: string) {
    println(MessageImpl.info(text))
  }

  /**
   * Print a warning message
   *
   * @param text - Message text
   */
  export function warn(text: string) {
    println(MessageImpl.warning(text))
  }

  /**
   * Print a success message
   *
   * @param text - Message text
   */
  export function success(text: string) {
    println(MessageImpl.success(text))
  }

  /**
   * Print an empty line (only once between sections)
   */
  export function empty() {
    if (blank) return
    println("" + StyleImpl.TEXT_NORMAL)
    blank = true
  }

  /**
   * Print an error message
   *
   * @param message - Error message
   */
  export function error(message: string) {
    println(MessageImpl.error(message))
  }

  // =============================================================================
  // Logo and Branding
  // =============================================================================

  /**
   * Get the Zee logo color.
   *
   * Maps to the closest ANSI color for CLI mode.
   * In TUI mode, full RGB theme colors are used instead.
   *
   * When NO_COLOR is set, returns empty string (no color).
   *
   * @param variant - The logo variant ("zee" or "default")
   * @returns ANSI color code for the logo
   *
   * @example
   * ```typescript
   * const zeeColor = UI.getLogoColor("zee");
   * ```
   */
  export function getLogoColor(variant: "zee" | "default" = "default"): string {
    switch (variant) {
      case "zee":
      case "default":
      default:
        return assistantColorsImpl.zee.logo
    }
  }

  /**
   * Render the ASCII logo with theme-aware coloring.
   *
   * CLI Mode: Uses ANSI colors mapped from theme
   * TUI Mode: Uses full RGB colors from theme.tsx
   *
   * When NO_COLOR is set, the logo renders without any color codes.
   *
   * @param pad - Optional padding string to prepend to each line
   * @param variant - Optional Zee logo variant
   * @returns Logo string with color codes
   *
   * @example
   * ```typescript
   * // Default logo (Zee)
   * console.log(UI.logo());
   *
   * // With padding
   * console.log(UI.logo("  "));
   * ```
   */
  export function logo(pad?: string, variant?: "zee" | "default"): string {
    const result = []
    // Use theme-aware logo color instead of hardcoded cyan
    // Style.reset and colors are automatically empty when NO_COLOR is set
    const color = getLogoColor(variant)
    for (const row of LOGO) {
      if (pad) result.push(pad)
      result.push(color)
      result.push(row)
      result.push(StyleImpl.reset)
      result.push(EOL)
    }
    return result.join("").trimEnd()
  }

  // =============================================================================
  // User Input
  // =============================================================================

  /**
   * Read a line of input from the user
   *
   * @param prompt - Prompt string to display
   * @returns User input (trimmed)
   *
   * @example
   * ```typescript
   * const name = await UI.input("Enter your name: ");
   * if (name) {
   *   UI.success(`Hello, ${name}!`);
   * }
   * ```
   */
  export async function input(prompt: string): Promise<string> {
    const readline = require("readline")
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(prompt, (answer: string) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  /**
   * Stub for markdown rendering (returns text as-is)
   *
   * @param text - Markdown text
   * @returns Plain text (markdown not processed in CLI mode)
   */
  export function markdown(text: string): string {
    return text
  }
}
