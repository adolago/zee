/**
 * @file JSON Formatter
 * @description Formats log entries as JSON for machine parsing
 */

import type { IFormatter, LogEntry } from "../types";

export class JsonFormatter implements IFormatter {
  format(entry: LogEntry): string {
    return JSON.stringify(entry);
  }
}
