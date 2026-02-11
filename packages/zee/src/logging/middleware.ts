/**
 * @file Logging Middleware
 * @description Helper functions for structured logging in agent operations
 */

import { getLogger } from "./logger-factory";
import { withLogContextAsync, getCorrelationId } from "./context";
import type { ILogger } from "./types";

/**
 * Wrap a session handler with logging context
 */
export async function withSessionLogging<T>(
  sessionId: string,
  fn: () => Promise<T>
): Promise<T> {
  return withLogContextAsync({ sessionId }, async () => {
    const logger = getLogger("session");
    logger.info("Session started", { sessionId });

    try {
      const result = await fn();
      logger.info("Session completed", { sessionId });
      return result;
    } catch (error) {
      logger.error("Session failed", error as Error, { sessionId });
      throw error;
    }
  });
}

/**
 * Log an agent iteration
 */
export function logAgentIteration(
  iterationNumber: number,
  metadata?: Record<string, unknown>
): void {
  const logger = getLogger("agent");
  logger.debug("Agent iteration", {
    iteration: iterationNumber,
    correlationId: getCorrelationId(),
    ...metadata,
  });
}

/**
 * Log token usage
 */
export function logTokenUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  model: string;
  cached?: number;
}): void {
  const logger = getLogger("tokens");
  logger.info("Token usage", {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.inputTokens + usage.outputTokens,
    cached: usage.cached,
    model: usage.model,
  });
}

/**
 * Log tool execution
 */
export function logToolExecution(
  toolName: string,
  durationMs: number,
  success: boolean,
  metadata?: Record<string, unknown>
): void {
  const logger = getLogger("tools");
  const level = success ? "info" : "warn";

  logger[level](`Tool: ${toolName}`, {
    tool: toolName,
    durationMs,
    success,
    ...metadata,
  });
}

/**
 * Log provider API call
 */
export function logProviderCall(
  provider: string,
  endpoint: string,
  durationMs: number,
  status: number | "error",
  metadata?: Record<string, unknown>
): void {
  const logger = getLogger("provider");
  const success = typeof status === "number" && status >= 200 && status < 300;

  logger[success ? "debug" : "warn"](`${provider} API call`, {
    provider,
    endpoint,
    durationMs,
    status,
    ...metadata,
  });
}

/**
 * Create a scoped logger for a specific operation
 */
export function createOperationLogger(
  operation: string,
  metadata?: Record<string, unknown>
): ILogger {
  return getLogger(operation).child({ metadata });
}
