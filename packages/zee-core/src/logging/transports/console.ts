/**
 * @file Console Transport
 * @description Writes logs to stdout/stderr
 */

import type { ITransport, IFormatter, LogEntry, LogLevel } from "../types";
import { PrettyFormatter } from "../formatters/pretty";
import { JsonFormatter } from "../formatters/json";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface ConsoleTransportOptions {
  level?: LogLevel;
  format?: "json" | "pretty";
  colors?: boolean;
}

export class ConsoleTransport implements ITransport {
  private formatter: IFormatter;
  private minLevel: number;

  constructor(options: ConsoleTransportOptions = {}) {
    const format = options.format || (process.stdout.isTTY ? "pretty" : "json");
    this.formatter = format === "json" 
      ? new JsonFormatter() 
      : new PrettyFormatter({ colors: options.colors });
    this.minLevel = LOG_LEVEL_PRIORITY[options.level || "trace"];
  }

  write(entry: LogEntry): void {
    if (LOG_LEVEL_PRIORITY[entry.level] < this.minLevel) return;

    const output = this.formatter.format(entry);
    
    // Use stderr for errors, stdout for everything else
    if (entry.level === "error" || entry.level === "fatal") {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  async flush(): Promise<void> {
    // Console is synchronous, nothing to flush
  }

  async close(): Promise<void> {
    // Nothing to close
  }
}
