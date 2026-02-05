/**
 * @file Logger Factory
 * @description Factory functions for creating configured loggers
 */

import * as path from "path";
import { Logger } from "./logger";
import { ConsoleTransport } from "./transports/console";
import { RotatingFileTransport } from "./transports/rotating-file";
import type { ILogger, LogLevel, ITransport } from "./types";
import { resolveLogsDir } from "../global/dirs";

/** Global logger instance */
let globalLogger: ILogger | null = null;

/** Logger registry by component */
const loggerRegistry = new Map<string, ILogger>();

/**
 * Get the default log directory
 */
function getDefaultLogDir(): string {
  return resolveLogsDir();
}

/**
 * Get the default log level from environment
 */
function getDefaultLevel(): LogLevel {
  const envLevel = process.env.AGENT_CORE_LOG_LEVEL?.toLowerCase();
  const validLevels: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
  
  if (envLevel && validLevels.includes(envLevel as LogLevel)) {
    return envLevel as LogLevel;
  }

  // Check for trace mode
  if (process.env.AGENT_CORE_TRACE === "1") {
    return "trace";
  }

  // Default based on environment
  return process.env.NODE_ENV === "development" ? "debug" : "info";
}

export interface LoggerOptions {
  level?: LogLevel;
  component?: string;
  console?: boolean;
  file?: boolean;
  filePath?: string;
  maxSize?: string;
  maxFiles?: number;
}

/**
 * Initialize the global logger
 */
export function initLogger(options: LoggerOptions = {}): ILogger {
  const level = options.level || getDefaultLevel();
  const transports: ITransport[] = [];

  // Console transport (default: enabled)
  if (options.console !== false) {
    transports.push(new ConsoleTransport({ level }));
  }

  // File transport (default: enabled in production)
  if (options.file !== false) {
    const logPath = options.filePath || path.join(getDefaultLogDir(), "agent-core.log");
    transports.push(
      new RotatingFileTransport({
        path: logPath,
        level,
        maxSize: options.maxSize || "10MB",
        maxFiles: options.maxFiles || 5,
        compress: true,
      })
    );
  }

  globalLogger = new Logger(
    {
      level,
      component: options.component || "core",
      includeStacks: true,
      transports,
    }
  );

  return globalLogger;
}

/**
 * Get the global logger instance
 */
export function getLogger(component?: string): ILogger {
  if (!globalLogger) {
    globalLogger = initLogger();
  }

  if (!component) {
    return globalLogger;
  }

  // Return cached component logger or create new one
  let logger = loggerRegistry.get(component);
  if (!logger) {
    logger = globalLogger.child({ component });
    loggerRegistry.set(component, logger);
  }

  return logger;
}

/**
 * Create a standalone logger (not connected to global)
 */
export function createLogger(options: LoggerOptions = {}): ILogger {
  const level = options.level || getDefaultLevel();
  const transports: ITransport[] = [];

  if (options.console !== false) {
    transports.push(new ConsoleTransport({ level }));
  }

  if (options.file && options.filePath) {
    transports.push(
      new RotatingFileTransport({
        path: options.filePath,
        level,
        maxSize: options.maxSize || "10MB",
        maxFiles: options.maxFiles || 5,
      })
    );
  }

  return new Logger({
    level,
    component: options.component,
    includeStacks: true,
    transports,
  });
}
