import type { CursorStyleOptions } from "@opentui/core"

export type TuiCursorConfig = {
  style?: "block" | "underline" | "line" | "default"
  blinking?: boolean
}

/**
 * Resolve the configured TUI cursor into OpenTUI options.
 * Returns undefined for the "default" style so the terminal keeps its own.
 */
export function resolveCursorStyle(cursor?: TuiCursorConfig): CursorStyleOptions | undefined {
  const style = cursor?.style ?? "block"
  if (style === "default") return undefined
  return { style, blinking: cursor?.blinking ?? true }
}
