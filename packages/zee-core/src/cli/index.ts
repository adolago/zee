/**
 * Unified CLI Style System
 *
 * Single source of truth for all CLI styling, formatting, and UI utilities.
 *
 * @example
 * ```typescript
 * // Import specific utilities
 * import { Style, Symbols, Message, UI } from "@/cli";
 *
 * // Use semantic colors
 * console.log(`${Style.success}Operation successful${Style.reset}`);
 *
 * // Use symbols with Unicode/ASCII fallback
 * console.log(`${Symbols.check} Done`);
 *
 * // Use message formatters
 * console.log(Message.success("Task completed"));
 *
 * // Use UI namespace for higher-level operations
 * UI.success("Task completed");
 * ```
 *
 * @example
 * ```typescript
 * // Box drawing helpers
 * import { box, Style, Symbols } from "@/cli";
 *
 * const myBox = box.draw([
 *   "Header",
 *   "Content line 1",
 *   "Content line 2"
 * ], { width: 40, padding: 1 });
 * console.log(myBox);
 * ```
 *
 * ## NO_COLOR Support
 *
 * All styling respects the NO_COLOR environment variable (https://no-color.org/).
 * When NO_COLOR is set:
 * - All color codes become empty strings
 * - Symbols fall back to ASCII equivalents
 * - Visual output is plain text only
 *
 * Use FORCE_COLOR to explicitly enable colors regardless of TTY detection.
 *
 * ## Unicode vs ASCII
 *
 * Symbols automatically adapt based on terminal capabilities:
 * - Unicode preferred (✓ ✗ → …)
 * - ASCII fallback ([OK] [X] -> ...)
 *
 * Use FORCE_UNICODE to explicitly enable Unicode symbols.
 * Use NO_UNICODE or ASCII_ONLY to force ASCII.
 *
 * @module
 */

// =============================================================================
// Core Style Exports (from style.ts)
// =============================================================================

export {
  // Detection utilities
  shouldUseColors,
  shouldUseUnicode,

  // ANSI color system
  Style,

  // Symbols with Unicode/ASCII fallback
  Symbols,
  getSymbol,

  // Message formatters
  Message,

  // Color/text helper functions
  color,
  success,
  warning,
  error,
  info,
  muted,
  dim,
  bold,
  stripAnsi,
  visualWidth,
  padEnd,

  // Status bar constants
  StatusBar,

  // Theme mappings
  themeToAnsi,
  personaColors,
} from "./style";

// =============================================================================
// Box Drawing Helpers (from box.ts)
// =============================================================================

export {
  box,
  BorderStyle,
  type BoxOptions,
  type BorderChars,
} from "./box";

// =============================================================================
// UI Namespace (from ui.ts)
// =============================================================================

export { UI } from "./ui";

// =============================================================================
// Re-export types explicitly for convenience
// =============================================================================

export type {
  // From style.ts (these are const objects, not types, but re-exported for completeness)
  // Style, Symbols, Message, StatusBar, themeToAnsi, personaColors
} from "./style";
