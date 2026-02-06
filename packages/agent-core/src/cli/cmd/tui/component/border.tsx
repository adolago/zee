/**
 * Border drawing patterns for TUI components
 *
 * Pattern: Prefer SplitBorder.customBorderChars for consistent styling.
 * Prompt/Tips intentionally use rounded borders for the billboard frame.
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

export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

/**
 * SplitBorder - Creates a vertical split line with "┃" character
 * Use this for all bordered components in the TUI
 */
export const SplitBorder = {
  border: ["left" as const, "right" as const],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
}

/**
 * RoundedBorder - Full border using rounded corners, matching the prompt frame.
 * Use this for dialogs/menus that should visually align with the prompt aesthetic.
 */
export const RoundedBorder = {
  border: ["left" as const, "right" as const, "top" as const, "bottom" as const],
  customBorderChars: {
    ...EmptyBorder,
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
    topT: "┬",
    bottomT: "┴",
    leftT: "├",
    rightT: "┤",
    cross: "┼",
  },
}

/**
 * SplitBorderVertical - Convenience export for single vertical border
 * Equivalent to SplitBorder.customBorderChars.vertical
 */
export const SplitBorderVertical = "┃"
