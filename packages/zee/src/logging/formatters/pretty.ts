/**
 * @file Pretty Formatter
 * @description Human-readable colored log output for terminals
 * 
 * NO_COLOR Support:
 * This formatter respects the NO_COLOR environment variable (https://no-color.org/).
 * When NO_COLOR is set, all ANSI color codes are disabled and plain text is output.
 * Use FORCE_COLOR to explicitly enable colors.
 */

import type { IFormatter, LogEntry, LogLevel } from "../types";
import { Timestamp } from "../../util/timestamp";

// Level colors - only used when colors are enabled
const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: "\x1b[90m",  // Gray
  debug: "\x1b[36m",  // Cyan
  info: "\x1b[32m",   // Green
  warn: "\x1b[33m",   // Yellow
  error: "\x1b[31m",  // Red
  fatal: "\x1b[35m",  // Magenta
};

// Empty colors when disabled
const NO_COLORS: Record<LogLevel, string> = {
  trace: "",
  debug: "",
  info: "",
  warn: "",
  error: "",
  fatal: "",
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  trace: "TRC",
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
  fatal: "FTL",
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

// Empty control codes when disabled
const NO_RESET = "";
const NO_DIM = "";
const NO_BOLD = "";

/**
 * Determine if colors should be used based on environment variables.
 * Follows the no-color.org standard.
 */
function shouldUseColors(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return process.stdout.isTTY ?? false;
}

export class PrettyFormatter implements IFormatter {
  private useColors: boolean;
  private colors: Record<LogLevel, string>;
  private reset: string;
  private dim: string;

  constructor(options: { colors?: boolean } = {}) {
    this.useColors = options.colors ?? shouldUseColors();
    // Use actual colors or empty strings based on configuration
    this.colors = this.useColors ? LEVEL_COLORS : NO_COLORS;
    this.reset = this.useColors ? RESET : NO_RESET;
    this.dim = this.useColors ? DIM : NO_DIM;
  }

  format(entry: LogEntry): string {
    const parts: string[] = [];

    // Timestamp (HH:MM:SS.mmm)
    const timeStr = Timestamp.log(new Date(entry.timestamp));
    parts.push(this.dimText(timeStr));

    // Level
    const levelColor = this.colors[entry.level];
    const levelLabel = LEVEL_LABELS[entry.level];
    parts.push(this.colorText(levelLabel, levelColor));

    // Component
    if (entry.component) {
      parts.push(this.dimText(`[${entry.component}]`));
    }

    // Message
    parts.push(entry.message);

    // Correlation ID (abbreviated)
    if (entry.correlationId) {
      const shortId = entry.correlationId.slice(-8);
      parts.push(this.dimText(`(${shortId})`));
    }

    // Metadata
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      const metaStr = Object.entries(entry.metadata)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      parts.push(this.dimText(metaStr));
    }

    // Duration
    if (entry.durationMs !== undefined) {
      parts.push(this.dimText(`${entry.durationMs}ms`));
    }

    let output = parts.join(" ");

    // Error stack
    if (entry.error?.stack) {
      output += "\n" + this.colorText(entry.error.stack, this.colors.error);
    }

    return output;
  }

  private colorText(text: string, color: string): string {
    if (!this.useColors) return text;
    return `${color}${text}${this.reset}`;
  }

  private dimText(text: string): string {
    if (!this.useColors) return text;
    return `${this.dim}${text}${this.reset}`;
  }
}
