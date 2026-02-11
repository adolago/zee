/**
 * Error Recovery Strategies
 *
 * Provides automatic retry, fallback, and escalation for tool failures.
 * Only retries idempotent/read operations -- never retries writes or deletes.
 */

import { Log } from "../../packages/zee/src/util/log";

const log = Log.create({ service: "swarm:recovery" });

// =============================================================================
// Types
// =============================================================================

export type RecoveryStrategy = "retry" | "fallback" | "escalate";

export interface RecoveryResult {
  strategy: RecoveryStrategy;
  attempted: boolean;
  success: boolean;
  attempts: number;
  finalError?: string;
  /** Human-readable guidance for escalation */
  guidance?: string;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
};

// =============================================================================
// Strategy Selection
// =============================================================================

/**
 * Suggest a recovery strategy based on the error type and tool context.
 */
export function suggestRecovery(error: Error, toolName: string): RecoveryStrategy {
  const msg = error.message.toLowerCase();

  // Network errors: retry with backoff
  if (
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network") ||
    msg.includes("timeout")
  ) {
    // Only retry if the tool is read-like / idempotent
    if (isIdempotent(toolName)) {
      return "retry";
    }
    return "escalate";
  }

  // Auth errors: escalate with guidance
  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("invalid_grant") ||
    msg.includes("permission denied")
  ) {
    return "escalate";
  }

  // Missing binary/env: escalate with install instructions
  if (
    msg.includes("enoent") ||
    msg.includes("not found") ||
    msg.includes("command not found") ||
    msg.includes("no such file")
  ) {
    return "escalate";
  }

  // Rate limiting: retry with longer backoff
  if (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  ) {
    return "retry";
  }

  // Default: escalate
  return "escalate";
}

/**
 * Check if a tool is considered idempotent (safe to retry).
 */
function isIdempotent(toolName: string): boolean {
  const readPatterns = [
    "search",
    "browse",
    "query",
    "list",
    "get",
    "status",
    "find",
    "check",
    "calendar",
    "banner-refresh",
    "plan-status",
  ];

  const lower = toolName.toLowerCase();
  return readPatterns.some((p) => lower.includes(p));
}

// =============================================================================
// Recovery Execution
// =============================================================================

/**
 * Execute a function with automatic retry on transient failures.
 * Uses exponential backoff with jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions & { toolName?: string },
): Promise<{ result: T; attempts: number } | { error: Error; attempts: number }> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        log.info("Retry succeeded", {
          tool: options?.toolName,
          attempt,
        });
      }
      return { result, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= opts.maxAttempts) break;

      // Check if this error is retryable
      const strategy = suggestRecovery(lastError, options?.toolName ?? "");
      if (strategy !== "retry") break;

      // Exponential backoff with jitter
      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200,
        opts.maxDelayMs,
      );

      log.debug("Retrying after error", {
        tool: options?.toolName,
        attempt,
        delay,
        error: lastError.message,
      });

      await sleep(delay);
    }
  }

  return { error: lastError!, attempts: opts.maxAttempts };
}

/**
 * Build a human-readable escalation message for an error.
 */
export function buildEscalation(error: Error, toolName: string): string {
  const msg = error.message.toLowerCase();

  if (msg.includes("econnrefused") || msg.includes("fetch failed")) {
    if (toolName.includes("memory") || toolName.includes("qdrant")) {
      return `Memory storage (Qdrant) is not reachable.

To fix:
1. Start Qdrant: docker run -p 6333:6333 qdrant/qdrant
2. Or check if another process is using port 6333

Error: ${error.message}`;
    }

    if (toolName.includes("gateway") || toolName.includes("messaging")) {
      return `Messaging gateway is not reachable.

To fix:
1. Start the zee daemon: zee daemon
2. Check gateway status: zee debug status

Error: ${error.message}`;
    }

    return `Service connection failed. Check that the required service is running.

Error: ${error.message}`;
  }

  if (msg.includes("401") || msg.includes("invalid_grant")) {
    return `Authentication failed. Re-authenticate or check your credentials.

Error: ${error.message}`;
  }

  if (msg.includes("permission denied") || msg.includes("403")) {
    return `Permission denied. Check access rights for the requested resource.

Error: ${error.message}`;
  }

  if (msg.includes("enoent") || msg.includes("not found")) {
    return `Required file or binary not found. Check installation.

Error: ${error.message}`;
  }

  if (msg.includes("429") || msg.includes("rate limit")) {
    return `Rate limited. Wait a moment and try again.

Error: ${error.message}`;
  }

  return `Operation failed: ${error.message}`;
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
