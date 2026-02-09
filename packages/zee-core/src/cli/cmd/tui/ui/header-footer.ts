/**
 * Header and Footer styling constants
 *
 * These constants ensure consistent styling across all headers and footers
 * in the TUI application.
 */

import { SplitBorder } from "@tui/component/border"

/**
 * Standard header styling configuration
 *
 * Usage:
 * ```tsx
 * <box {...Header.style} borderColor={theme.border}>
 *   <text style={{ bold: Header.titleStyle }}>Title</text>
 * </box>
 * ```
 */
export const Header = {
  /** Standard padding for header content (top: 0, bottom: 1, left: 0, right: 0) */
  padding: { top: 0, bottom: 1, left: 0, right: 0 },

  /** Border color for headers - uses theme.border */
  borderColor: "theme.border" as const,

  /** Title style - always bold */
  titleStyle: "bold" as const,

  /** Breadcrumb separator color - uses theme.textMuted for subtle appearance */
  breadcrumbSeparatorColor: "theme.textMuted" as const,

  /** Keybind hint color - uses theme.textMuted for consistency with status bar */
  keybindColor: "theme.textMuted" as const,

  /** Flex shrink - header should not grow */
  flexShrink: 0,

  /**
   * Complete style object for spreading into box components
   * Includes padding and SplitBorder for consistent left border
   *
   * Note: borderColor must be set separately from theme
   */
  get style() {
    return {
      paddingTop: this.padding.top,
      paddingBottom: this.padding.bottom,
      paddingLeft: this.padding.left,
      paddingRight: this.padding.right,
      ...SplitBorder,
      border: ["left" as const],
      flexShrink: 0,
    }
  },
}

/**
 * Standard footer styling configuration
 *
 * The footer typically renders the StatusBar component which has its own
 * internal styling. This constant provides the container styling.
 */
export const Footer = {
  /** Standard padding for footer content */
  padding: { top: 0, bottom: 0, left: 1, right: 1 },

  /** Flex shrink - footer should not grow */
  flexShrink: 0,

  /** Keybind hint color - matches status bar hint color */
  keybindColor: "theme.textMuted" as const,
}

/**
 * SplitBorder usage pattern:
 *
 * The SplitBorder component creates a vertical split line with "┃" character.
 * It should be used for all bordered components in the TUI for consistency.
 *
 * Pattern: Always use SplitBorder.customBorderChars for consistent styling
 *
 * Usage options:
 * 1. Spread the full SplitBorder object: {...SplitBorder}
 * 2. Use customBorderChars with specific border sides: customBorderChars={SplitBorder.customBorderChars}
 *
 * Border colors by component type:
 * - Dialog: theme.borderActive
 * - Header: theme.border
 * - Sidebar: theme.borderSubtle
 * - Toast: theme[variant] (error, warning, success, info)
 * - WhichKey: theme.primary
 * - Autocomplete: theme.border
 */
