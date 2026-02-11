/**
 * @file Logging Types
 * @description Type definitions for the structured logging system
 */

/** Log severity levels */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/** Numeric priority for log levels (higher = more severe) */
export const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * A single log entry
 */
export interface LogEntry {
  /** Log level */
  level: LogLevel;

  /** ISO timestamp */
  timestamp: string;

  /** Log message */
  message: string;

  /** Component/module that produced this log */
  component?: string;

  /** Correlation ID for request tracing */
  correlationId?: string;

  /** Session ID if applicable */
  sessionId?: string;

  /** Additional structured data */
  metadata?: Record<string, unknown>;

  /** Error information if this is an error log */
  error?: ErrorInfo;

  /** Duration in ms (for timed operations) */
  durationMs?: number;
}

/**
 * Structured error information
 */
export interface ErrorInfo {
  /** Error name/type */
  name: string;

  /** Error message */
  message: string;

  /** Stack trace (if available and enabled) */
  stack?: string;

  /** Error code (if available) */
  code?: string;

  /** Cause chain */
  cause?: ErrorInfo;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum level to log */
  level: LogLevel;

  /** Component name for this logger */
  component?: string;

  /** Include stack traces in error logs */
  includeStacks: boolean;

  /** Transports to write to */
  transports: ITransport[];

  /** Patterns to redact from logs */
  redactPatterns?: RegExp[];
}

/**
 * Transport configuration
 */
export interface TransportConfig {
  /** Transport type */
  type: "console" | "file" | "rotating-file";

  /** Minimum level for this transport */
  level?: LogLevel;

  /** Formatter to use */
  format?: "json" | "pretty";

  /** File path (for file transports) */
  path?: string;

  /** Max file size before rotation */
  maxSize?: string;

  /** Number of rotated files to keep */
  maxFiles?: number;

  /** Compress rotated files */
  compress?: boolean;
}

/**
 * Logger interface
 */
export interface ILogger {
  trace(message: string, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, error?: Error, metadata?: Record<string, unknown>): void;
  fatal(message: string, error?: Error, metadata?: Record<string, unknown>): void;

  /** Create a child logger with additional context */
  child(context: { component?: string; metadata?: Record<string, unknown> }): ILogger;

  /** Start a timer that logs duration on end */
  startTimer(label: string): TimerHandle;

  /** Check if a level is enabled */
  isLevelEnabled(level: LogLevel): boolean;
}

/**
 * Transport interface
 */
export interface ITransport {
  /** Write a log entry */
  write(entry: LogEntry): void;

  /** Flush pending writes */
  flush(): Promise<void>;

  /** Close the transport */
  close(): Promise<void>;
}

/**
 * Formatter interface
 */
export interface IFormatter {
  /** Format a log entry to string */
  format(entry: LogEntry): string;
}

/**
 * Timer handle returned by startTimer
 */
export interface TimerHandle {
  /** End the timer and log the duration */
  end(metadata?: Record<string, unknown>): void;

  /** Get elapsed time without logging */
  elapsed(): number;
}

/**
 * Log context for async operations
 */
export interface LogContext {
  correlationId?: string;
  sessionId?: string;
  userId?: string;
  requestId?: string;
  [key: string]: unknown;
}
