/**
 * @file Logging Module
 * @description Main exports for the structured logging system
 */

// Types
export type {
  LogLevel,
  LogEntry,
  ErrorInfo,
  LoggerConfig,
  TransportConfig,
  ILogger,
  ITransport,
  IFormatter,
  TimerHandle,
  LogContext,
} from "./types";

export { LOG_LEVELS } from "./types";

// Core logger
export { Logger } from "./logger";

// Factory
export { initLogger, getLogger, createLogger, type LoggerOptions } from "./logger-factory";

// Context
export {
  withLogContext,
  withLogContextAsync,
  getCorrelationId,
  getSessionId,
  getLogContext,
  setContextValue,
} from "./context";

// Formatters
export { JsonFormatter, PrettyFormatter } from "./formatters";

// Transports
export {
  ConsoleTransport,
  FileTransport,
  RotatingFileTransport,
  type ConsoleTransportOptions,
  type FileTransportOptions,
  type RotatingFileTransportOptions,
} from "./transports";

// Middleware
export {
  withSessionLogging,
  logAgentIteration,
  logTokenUsage,
  logToolExecution,
  logProviderCall,
  createOperationLogger,
} from "./middleware";
