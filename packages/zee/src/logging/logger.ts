/**
 * @file Core Logger
 * @description Main Logger class implementation
 */

import type {
  ILogger,
  LogLevel,
  LogEntry,
  LoggerConfig,
  ErrorInfo,
  TimerHandle,
} from "./types";
import { getCorrelationId, getSessionId } from "./context";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** Sensitive patterns to redact */
const DEFAULT_REDACT_PATTERNS = [
  /sk-ant-[a-zA-Z0-9-_]+/g,           // Anthropic keys
  /sk-[a-zA-Z0-9]{32,}/g,              // OpenAI keys
  /AIza[a-zA-Z0-9_-]{35}/g,            // Google API keys
  /ghp_[a-zA-Z0-9]{36}/g,              // GitHub tokens
  /ghs_[a-zA-Z0-9]{36}/g,              // GitHub tokens
  /Bearer\s+[a-zA-Z0-9._-]+/gi,        // Bearer tokens
  /password["']?\s*[:=]\s*["'][^"']+/gi, // Passwords
];

export class Logger implements ILogger {
  private config: LoggerConfig;
  private metadata: Record<string, unknown>;

  constructor(config: Partial<LoggerConfig> = {}, metadata: Record<string, unknown> = {}) {
    this.config = {
      level: config.level || "info",
      component: config.component,
      includeStacks: config.includeStacks ?? true,
      transports: config.transports || [],
      redactPatterns: config.redactPatterns || DEFAULT_REDACT_PATTERNS,
    };
    this.metadata = metadata;
  }

  trace(message: string, metadata?: Record<string, unknown>): void {
    this.log("trace", message, undefined, metadata);
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log("debug", message, undefined, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log("info", message, undefined, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log("warn", message, undefined, metadata);
  }

  error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.log("error", message, error, metadata);
  }

  fatal(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.log("fatal", message, error, metadata);
  }

  child(context: { component?: string; metadata?: Record<string, unknown> }): ILogger {
    return new Logger(
      {
        ...this.config,
        component: context.component || this.config.component,
      },
      { ...this.metadata, ...context.metadata }
    );
  }

  startTimer(label: string): TimerHandle {
    const start = Date.now();
    return {
      end: (metadata?: Record<string, unknown>) => {
        const durationMs = Date.now() - start;
        this.info(`${label} completed`, { ...metadata, durationMs });
      },
      elapsed: () => Date.now() - start,
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  private log(
    level: LogLevel,
    message: string,
    error?: Error,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.isLevelEnabled(level)) return;

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message: this.redactSensitive(message),
      component: this.config.component,
      correlationId: getCorrelationId(),
      sessionId: getSessionId(),
      metadata: this.redactObject({ ...this.metadata, ...metadata }),
      error: error ? this.formatError(error) : undefined,
    };

    for (const transport of this.config.transports) {
      try {
        transport.write(entry);
      } catch (e) {
        // Don't let transport errors crash the app
        console.error("Transport error:", e);
      }
    }
  }

  private formatError(error: Error): ErrorInfo {
    const info: ErrorInfo = {
      name: error.name,
      message: this.redactSensitive(error.message),
    };

    if (this.config.includeStacks && error.stack) {
      info.stack = this.redactSensitive(error.stack);
    }

    if ("code" in error && typeof error.code === "string") {
      info.code = error.code;
    }

    if (error.cause instanceof Error) {
      info.cause = this.formatError(error.cause);
    }

    return info;
  }

  private redactSensitive(text: string): string {
    let result = text;
    for (const pattern of this.config.redactPatterns || []) {
      result = result.replace(pattern, "[REDACTED]");
    }
    return result;
  }

  private redactObject(obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!obj) return undefined;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        result[key] = this.redactSensitive(value);
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.redactObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
