/**
 * @file Log Collector
 * @description Collects and sanitizes recent log entries
 */

import * as fs from "fs/promises";
import * as path from "path";
import { PrivacyRedactor } from "../privacy/redactor";
import type { LogEntry } from "../types";
import { resolveDataDir, resolveLogsDir } from "../../global/dirs";

function getLogsDirs(): string[] {
  // Zee core logs default to `${XDG_DATA_HOME}/zee/log`, while some components/tools
  // may use `${XDG_STATE_HOME}/zee/logs`. Check both.
  return [path.join(resolveDataDir(), "log"), resolveLogsDir()];
}

async function findMostRecentLogFile(dirs: string[]): Promise<string | null> {
  const candidates: Array<{ filePath: string; mtimeMs: number }> = [];
  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".log")) continue;
        const filePath = path.join(dir, entry.name);
        const stat = await fs.stat(filePath);
        candidates.push({ filePath, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Ignore missing/unreadable dirs.
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath ?? null;
}

/**
 * Collect recent log entries
 */
export async function collectLogs(
  redactor: PrivacyRedactor,
  options: { lineCount: number } = { lineCount: 500 }
): Promise<LogEntry[]> {
  const logPath = await findMostRecentLogFile(getLogsDirs());
  if (!logPath) return [];

  try {
    const lines = await readLastLines(logPath, options.lineCount);
    const entries: LogEntry[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        // Try JSON format first
        const parsed = JSON.parse(line);
        entries.push({
          timestamp: parsed.timestamp || new Date().toISOString(),
          level: parsed.level || "info",
          message: redactor.redact(parsed.message || ""),
          component: parsed.component,
        });
      } catch {
        // Fall back to raw line
        entries.push({
          timestamp: new Date().toISOString(),
          level: "info",
          message: redactor.redact(line),
        });
      }
    }

    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Read the last N lines from a file efficiently
 */
async function readLastLines(filePath: string, count: number): Promise<string[]> {
  const CHUNK_SIZE = 64 * 1024; // 64KB chunks
  const handle = await fs.open(filePath, "r");

  try {
    const stat = await handle.stat();
    const fileSize = stat.size;

    if (fileSize === 0) return [];

    const lines: string[] = [];
    let position = fileSize;
    let buffer = "";

    while (position > 0 && lines.length < count) {
      const readSize = Math.min(CHUNK_SIZE, position);
      position -= readSize;

      const chunk = Buffer.alloc(readSize);
      await handle.read(chunk, 0, readSize, position);

      buffer = chunk.toString("utf-8") + buffer;
      const parts = buffer.split("\n");

      // Keep incomplete first line in buffer
      buffer = parts.shift() || "";

      // Add complete lines (reversed, we're reading backwards)
      for (let i = parts.length - 1; i >= 0 && lines.length < count; i--) {
        if (parts[i].trim()) {
          lines.unshift(parts[i]);
        }
      }
    }

    // Don't forget remaining buffer
    if (buffer.trim() && lines.length < count) {
      lines.unshift(buffer);
    }

    return lines.slice(-count);
  } finally {
    await handle.close();
  }
}
