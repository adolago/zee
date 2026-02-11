/**
 * @file Timestamp Utility
 * @description Unified timestamp formatting across the codebase
 *
 * Standards:
 * - Logs: HH:MM:SS.mmm (with milliseconds for precision)
 * - User display: ISO 8601 or locale string
 * - Machine-readable: Full ISO 8601
 */

export const Timestamp = {
  /**
   * ISO 8601 format: 2024-01-15T10:30:00.000Z
   * Use for: Machine-readable timestamps, API responses, storage
   */
  iso: (date: Date = new Date()): string => date.toISOString(),

  /**
   * Locale string format: 1/15/2024, 10:30:00 AM
   * Use for: User-facing display in local timezone
   */
  pretty: (date: Date = new Date()): string => date.toLocaleString(),

  /**
   * Locale time format: 10:30:00 AM
   * Use for: Time-only display
   */
  time: (date: Date = new Date()): string => date.toLocaleTimeString(),

  /**
   * Date-only format: 2024-01-15
   * Use for: Date keys, file names
   */
  date: (date: Date = new Date()): string => date.toISOString().split("T")[0],

  /**
   * Log format: HH:MM:SS.mmm
   * Use for: Log output with millisecond precision
   */
  log: (date: Date = new Date()): string => {
    const hours = date.getHours().toString().padStart(2, "0")
    const minutes = date.getMinutes().toString().padStart(2, "0")
    const seconds = date.getSeconds().toString().padStart(2, "0")
    const ms = date.getMilliseconds().toString().padStart(3, "0")
    return `${hours}:${minutes}:${seconds}.${ms}`
  },

  /**
   * Compact format: YYYYMMDD-HHMMSS
   * Use for: File names, identifiers
   */
  compact: (date: Date = new Date()): string =>
    date.toISOString().split(".")[0].replace(/[-:T]/g, ""),

  /**
   * Unix timestamp in milliseconds
   * Use for: Internal storage, calculations
   */
  ms: (date: Date = new Date()): number => date.getTime(),
}

/**
 * Format a timestamp from various inputs to ISO 8601
 */
export function toISOString(input: Date | string | number | undefined): string {
  if (!input) return Timestamp.iso()
  if (input instanceof Date) return input.toISOString()
  if (typeof input === "number") return new Date(input).toISOString()
  return input
}

/**
 * Format a timestamp for log display
 */
export function toLogString(input: Date | string | number | undefined): string {
  if (!input) return Timestamp.log()
  if (input instanceof Date) return Timestamp.log(input)
  if (typeof input === "number") return Timestamp.log(new Date(input))
  // Try to parse and reformat
  try {
    return Timestamp.log(new Date(input))
  } catch {
    return input
  }
}
