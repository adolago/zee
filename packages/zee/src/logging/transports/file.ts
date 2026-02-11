/**
 * @file File Transport
 * @description Writes logs to a file with async buffering
 */

import * as fs from "fs";
import * as path from "path";
import type { ITransport, IFormatter, LogEntry, LogLevel } from "../types";
import { JsonFormatter } from "../formatters/json";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface FileTransportOptions {
  path: string;
  level?: LogLevel;
  format?: "json" | "pretty";
  bufferSize?: number;
  flushInterval?: number;
}

export class FileTransport implements ITransport {
  private formatter: IFormatter;
  private minLevel: number;
  private filePath: string;
  private buffer: string[] = [];
  private bufferSize: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private writeStream: fs.WriteStream | null = null;

  constructor(options: FileTransportOptions) {
    this.filePath = options.path;
    this.formatter = new JsonFormatter(); // Files always use JSON
    this.minLevel = LOG_LEVEL_PRIORITY[options.level || "trace"];
    this.bufferSize = options.bufferSize || 100;

    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open write stream
    this.writeStream = fs.createWriteStream(this.filePath, { flags: "a" });

    // Set up periodic flush
    const interval = options.flushInterval || 1000;
    this.flushTimer = setInterval(() => this.flush(), interval);
  }

  write(entry: LogEntry): void {
    if (LOG_LEVEL_PRIORITY[entry.level] < this.minLevel) return;

    const output = this.formatter.format(entry);
    this.buffer.push(output);

    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.writeStream) return;

    const lines = this.buffer.join("\n") + "\n";
    this.buffer = [];

    return new Promise((resolve, reject) => {
      this.writeStream!.write(lines, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();

    return new Promise((resolve) => {
      if (this.writeStream) {
        this.writeStream.end(() => resolve());
        this.writeStream = null;
      } else {
        resolve();
      }
    });
  }
}
