/**
 * Box Drawing Utilities
 *
 * Simple, flexible box drawing for CLI output.
 * Automatically handles Unicode/ASCII fallback and color support.
 *
 * @example
 * ```typescript
 * import { box, Style } from "@/cli";
 *
 * // Simple box
 * console.log(box.draw(["Hello", "World"]));
 *
 * // Styled box with custom width
 * console.log(box.draw(
 *   ["Header", "", "Content here"],
 *   { width: 40, padding: 1, style: BorderStyle.SINGLE }
 * ));
 *
 * // Info box using theme colors
 * console.log(box.info("Information message"));
 *
 * // Error box
 * console.log(box.error("Error message"));
 * ```
 */

import { Style, shouldUseUnicode } from "./style";

/**
 * Border style presets
 */
export enum BorderStyle {
  /** Single line border (─│┌┐└┘) */
  SINGLE = "single",
  /** Double line border (═║╔╗╚╝) */
  DOUBLE = "double",
  /** Rounded corners (─│╭╮╰╯) */
  ROUNDED = "rounded",
  /** ASCII only (+|-|) */
  ASCII = "ascii",
}

/**
 * Border character definitions
 */
export interface BorderChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
}

/**
 * Options for drawing a box
 */
export interface BoxOptions {
  /** Minimum width of the box (default: auto from content) */
  width?: number;
  /** Horizontal padding inside the box (default: 1) */
  padding?: number;
  /** Border style (default: SINGLE) */
  style?: BorderStyle;
  /** Border color (default: theme.border) */
  borderColor?: string;
  /** Content color (default: none) */
  contentColor?: string;
  /** Title for the box (displayed on top border) */
  title?: string;
}

/** Unicode border characters for each style */
const UNICODE_BORDERS: Record<BorderStyle, BorderChars> = {
  [BorderStyle.SINGLE]: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
  },
  [BorderStyle.DOUBLE]: {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
  },
  [BorderStyle.ROUNDED]: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
  },
  [BorderStyle.ASCII]: {
    topLeft: "+",
    topRight: "+",
    bottomLeft: "+",
    bottomRight: "+",
    horizontal: "-",
    vertical: "|",
  },
};

/** ASCII fallback border characters */
const ASCII_BORDERS: BorderChars = {
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
};

/**
 * Get border characters based on style and terminal capabilities
 */
function getBorders(style: BorderStyle = BorderStyle.SINGLE): BorderChars {
  const useUnicode = shouldUseUnicode();
  if (!useUnicode || style === BorderStyle.ASCII) {
    return ASCII_BORDERS;
  }
  return UNICODE_BORDERS[style] || UNICODE_BORDERS[BorderStyle.SINGLE];
}

/**
 * Calculate the visual width of a string (excluding ANSI codes)
 */
function visualWidth(str: string): number {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/**
 * Pad a string to a specific visual width
 */
function padEnd(str: string, width: number): string {
  const strWidth = visualWidth(str);
  if (strWidth >= width) return str;
  return str + " ".repeat(width - strWidth);
}

/**
 * Wrap text to fit within a given width
 */
function wrapText(text: string, width: number): string[] {
  if (visualWidth(text) <= width) return [text];

  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (visualWidth(testLine) <= width) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.length ? lines : [text];
}

/**
 * Draw a box around content lines
 *
 * @param lines - Content lines to display inside the box
 * @param options - Box styling options
 * @returns Formatted box string
 *
 * @example
 * ```typescript
 * const output = box.draw([
 *   "This is a simple box",
 *   "with multiple lines"
 * ], { width: 30, padding: 2 });
 * console.log(output);
 * // Output:
 * // ┌────────────────────────────┐
 * // │                            │
 * // │  This is a simple box      │
 * // │  with multiple lines       │
 * // │                            │
 * // └────────────────────────────┘
 * ```
 */
function draw(lines: string[], options: BoxOptions = {}): string {
  const {
    padding = 1,
    style = BorderStyle.SINGLE,
    borderColor = Style.theme.border,
    contentColor = "",
    title,
  } = options;

  const borders = getBorders(style);
  const reset = Style.reset;

  // Calculate dimensions
  const contentWidth =
    options.width ??
    Math.max(...lines.map((l) => visualWidth(l)), title ? visualWidth(title) + 4 : 0);
  const innerWidth = contentWidth + padding * 2;

  const result: string[] = [];

  // Top border with optional title
  if (title) {
    const titlePadding = 2;
    const titleWidth = visualWidth(title);
    const remainingWidth = innerWidth - titleWidth - titlePadding * 2;
    const leftWidth = Math.floor(remainingWidth / 2);
    const rightWidth = remainingWidth - leftWidth;
    result.push(
      `${borderColor}${borders.topLeft}${borders.horizontal.repeat(leftWidth)}${reset} ` +
        `${Style.bold}${title}${reset} ` +
        `${borderColor}${borders.horizontal.repeat(rightWidth)}${borders.topRight}${reset}`,
    );
  } else {
    result.push(
      `${borderColor}${borders.topLeft}${borders.horizontal.repeat(innerWidth)}${borders.topRight}${reset}`,
    );
  }

  // Empty padding at top
  for (let i = 0; i < padding; i++) {
    result.push(
      `${borderColor}${borders.vertical}${reset}${" ".repeat(innerWidth)}${borderColor}${borders.vertical}${reset}`,
    );
  }

  // Content lines
  for (const line of lines) {
    const wrapped = wrapText(line, contentWidth);
    for (const wrappedLine of wrapped) {
      const padded = padEnd(wrappedLine, contentWidth);
      result.push(
        `${borderColor}${borders.vertical}${reset}${" ".repeat(padding)}${contentColor}${padded}${reset}${" ".repeat(padding)}${borderColor}${borders.vertical}${reset}`,
      );
    }
  }

  // Empty padding at bottom
  for (let i = 0; i < padding; i++) {
    result.push(
      `${borderColor}${borders.vertical}${reset}${" ".repeat(innerWidth)}${borderColor}${borders.vertical}${reset}`,
    );
  }

  // Bottom border
  result.push(
    `${borderColor}${borders.bottomLeft}${borders.horizontal.repeat(innerWidth)}${borders.bottomRight}${reset}`,
  );

  return result.join("\n");
}

/**
 * Create a simple info box
 *
 * @param text - Content text
 * @param title - Optional title
 * @returns Formatted info box
 *
 * @example
 * ```typescript
 * console.log(box.info("Operation completed successfully", "Success"));
 * ```
 */
function info(text: string, title?: string): string {
  return draw([text], {
    style: BorderStyle.SINGLE,
    borderColor: Style.info,
    padding: 1,
    title,
  });
}

/**
 * Create a success box
 *
 * @param text - Content text
 * @param title - Optional title
 * @returns Formatted success box
 *
 * @example
 * ```typescript
 * console.log(box.success("Configuration saved", "Done"));
 * ```
 */
function success(text: string, title?: string): string {
  return draw([text], {
    style: BorderStyle.SINGLE,
    borderColor: Style.success,
    padding: 1,
    title,
  });
}

/**
 * Create a warning box
 *
 * @param text - Content text
 * @param title - Optional title
 * @returns Formatted warning box
 *
 * @example
 * ```typescript
 * console.log(box.warning("Disk space is low", "Warning"));
 * ```
 */
function warn(text: string, title?: string): string {
  return draw([text], {
    style: BorderStyle.SINGLE,
    borderColor: Style.warning,
    padding: 1,
    title,
  });
}

/**
 * Create an error box
 *
 * @param text - Content text
 * @param title - Optional title
 * @returns Formatted error box
 *
 * @example
 * ```typescript
 * console.log(box.error("Connection failed", "Error"));
 * ```
 */
function error(text: string, title?: string): string {
  return draw([text], {
    style: BorderStyle.SINGLE,
    borderColor: Style.error,
    padding: 1,
    title,
  });
}

/**
 * Box drawing utilities namespace
 *
 * Provides methods for creating various types of boxes
 * with consistent styling and automatic Unicode/ASCII fallback.
 */
export const box = {
  draw,
  info,
  success,
  warn,
  error,

  /** Border style presets */
  BorderStyle,

  /** Check if Unicode is available */
  shouldUseUnicode,
} as const;
