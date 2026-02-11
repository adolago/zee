/**
 * @file Rotating File Transport
 * @description File transport with size-based rotation and optional compression
 */

import * as fs from "fs";
import * as path from "path";
import { createGzip } from "zlib";
import { pipeline } from "stream/promises";
import type { ITransport, LogEntry, LogLevel } from "../types";
import { JsonFormatter } from "../formatters/json";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface RotatingFileTransportOptions {
  path: string;
  level?: LogLevel;
  maxSize?: string;     // e.g., "10MB", "1GB"
  maxFiles?: number;
  compress?: boolean;
  bufferSize?: number;
  flushInterval?: number;
}

export class RotatingFileTransport implements ITransport {
  private formatter = new JsonFormatter();
  private minLevel: number;
  private filePath: string;
  private maxSizeBytes: number;
  private maxFiles: number;
  private compress: boolean;
  private buffer: string[] = [];
  private bufferSize: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private writeStream: fs.WriteStream | null = null;
  private currentSize = 0;

  constructor(options: RotatingFileTransportOptions) {
    this.filePath = options.path;
    this.minLevel = LOG_LEVEL_PRIORITY[options.level || "trace"];
    this.maxSizeBytes = this.parseSize(options.maxSize || "10MB");
    this.maxFiles = options.maxFiles || 5;
    this.compress = options.compress ?? true;
    this.bufferSize = options.bufferSize || 100;

    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Get current file size
    try {
      const stat = fs.statSync(this.filePath);
      this.currentSize = stat.size;
    } catch {
      this.currentSize = 0;
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
    const bytes = Buffer.byteLength(lines);
    this.buffer = [];

    // Check if rotation needed
    if (this.currentSize + bytes > this.maxSizeBytes) {
      await this.rotate();
    }

    return new Promise((resolve, reject) => {
      this.writeStream!.write(lines, (err) => {
        if (err) {
          reject(err);
        } else {
          this.currentSize += bytes;
          resolve();
        }
      });
    });
  }

  private async rotate(): Promise<void> {
    // Close current stream
    await new Promise<void>((resolve) => {
      if (this.writeStream) {
        this.writeStream.end(() => resolve());
      } else {
        resolve();
      }
    });

    // Rotate existing files
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const ext = this.compress ? ".gz" : "";
      const oldPath = i === 1 
        ? `${this.filePath}${ext}`
        : `${this.filePath}.${i - 1}${ext}`;
      const newPath = `${this.filePath}.${i}${ext}`;

      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
      }
    }

    // Compress and move current file
    if (this.compress && fs.existsSync(this.filePath)) {
      const gzPath = `${this.filePath}.gz`;
      await this.compressFile(this.filePath, gzPath);
      fs.unlinkSync(this.filePath);
    } else if (fs.existsSync(this.filePath)) {
      fs.renameSync(this.filePath, `${this.filePath}.1`);
    }

    // Clean up old files
    this.cleanupOldFiles();

    // Open new stream
    this.writeStream = fs.createWriteStream(this.filePath, { flags: "a" });
    this.currentSize = 0;
  }

  private async compressFile(src: string, dest: string): Promise<void> {
    const readStream = fs.createReadStream(src);
    const writeStream = fs.createWriteStream(dest);
    const gzip = createGzip({ level: 9 });
    await pipeline(readStream, gzip, writeStream);
  }

  private cleanupOldFiles(): void {
    const dir = path.dirname(this.filePath);
    const base = path.basename(this.filePath);
    const files = fs.readdirSync(dir);

    // Validate that dir is a resolved absolute path to prevent traversal
    const resolvedDir = path.resolve(dir);

    const rotatedFiles = files
      .filter((f) => f.startsWith(base) && f !== base)
      .sort()
      .reverse();

    // Remove files beyond maxFiles
    for (let i = this.maxFiles; i < rotatedFiles.length; i++) {
      const filename = rotatedFiles[i];
      // Validate filename doesn't contain path separators or traversal
      if (filename.includes(path.sep) || filename.includes("..")) {
        continue;
      }
      const targetPath = path.join(resolvedDir, filename);
      // Ensure the resolved path is still within the expected directory
      const resolvedTarget = path.resolve(targetPath);
      if (!resolvedTarget.startsWith(resolvedDir + path.sep)) {
        continue;
      }
      fs.unlinkSync(resolvedTarget);
    }
  }

  private parseSize(size: string): number {
    const match = size.match(/^(\d+)(KB|MB|GB)?$/i);
    if (!match) return 10 * 1024 * 1024; // Default 10MB

    const num = parseInt(match[1], 10);
    const unit = (match[2] || "B").toUpperCase();

    switch (unit) {
      case "KB": return num * 1024;
      case "MB": return num * 1024 * 1024;
      case "GB": return num * 1024 * 1024 * 1024;
      default: return num;
    }
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
