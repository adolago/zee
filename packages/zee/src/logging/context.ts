/**
 * @file Async Log Context
 * @description AsyncLocalStorage-based context for correlation IDs
 */

import { AsyncLocalStorage } from "async_hooks";
import type { LogContext } from "./types";

/** Async storage for log context */
const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

/** Generate a unique correlation ID */
function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Run a function with log context
 */
export function withLogContext<T>(
  context: Partial<LogContext>,
  fn: () => T
): T {
  const currentContext = asyncLocalStorage.getStore() || {};
  const newContext: LogContext = {
    ...currentContext,
    ...context,
    correlationId: context.correlationId || currentContext.correlationId || generateCorrelationId(),
  };
  return asyncLocalStorage.run(newContext, fn);
}

/**
 * Run an async function with log context
 */
export async function withLogContextAsync<T>(
  context: Partial<LogContext>,
  fn: () => Promise<T>
): Promise<T> {
  const currentContext = asyncLocalStorage.getStore() || {};
  const newContext: LogContext = {
    ...currentContext,
    ...context,
    correlationId: context.correlationId || currentContext.correlationId || generateCorrelationId(),
  };
  return asyncLocalStorage.run(newContext, fn);
}

/**
 * Get the current correlation ID
 */
export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}

/**
 * Get the current session ID
 */
export function getSessionId(): string | undefined {
  return asyncLocalStorage.getStore()?.sessionId;
}

/**
 * Get the full current log context
 */
export function getLogContext(): LogContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Set a value in the current context (creates new context scope)
 */
export function setContextValue<K extends keyof LogContext>(
  key: K,
  value: LogContext[K]
): void {
  const current = asyncLocalStorage.getStore();
  if (current) {
    current[key] = value;
  }
}
