/**
 * Investing SDK Error Hierarchy
 */

/** Base error for all Investing SDK errors */
export class InvestingError extends Error {
  constructor(message: string, public readonly code: string, public override readonly cause?: Error) {
    super(message);
    this.name = "InvestingError";
  }
}

/** Network-level errors (DNS, connection refused, etc.) */
export class InvestingNetworkError extends InvestingError {
  constructor(message: string, cause?: Error) {
    super(message, "NETWORK_ERROR", cause);
    this.name = "InvestingNetworkError";
  }
}

/** Request timeout */
export class InvestingTimeoutError extends InvestingError {
  constructor(public readonly timeoutMs: number, cause?: Error) {
    super(`Request timed out after ${timeoutMs}ms`, "TIMEOUT", cause);
    this.name = "InvestingTimeoutError";
  }
}

/** Authentication/authorization errors (401, 403) */
export class InvestingAuthError extends InvestingError {
  constructor(message: string, public readonly statusCode: number = 401) {
    super(message, "AUTH_ERROR");
    this.name = "InvestingAuthError";
  }
}

/** API errors (4xx, 5xx) */
export class InvestingApiError extends InvestingError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string
  ) {
    super(message, "API_ERROR");
    this.name = "InvestingApiError";
  }
}

/** Investing server is not running */
export class InvestingNotRunningError extends InvestingError {
  constructor(public readonly baseUrl: string) {
    super(`Investing API not running at ${baseUrl}`, "NOT_RUNNING");
    this.name = "InvestingNotRunningError";
  }
}

/** Daemon lifecycle errors */
export class InvestingDaemonError extends InvestingError {
  constructor(message: string, cause?: Error) {
    super(message, "DAEMON_ERROR", cause);
    this.name = "InvestingDaemonError";
  }
}

/** Rate limited (429) */
export class InvestingRateLimitError extends InvestingError {
  constructor(public readonly retryAfterMs?: number) {
    super(
      retryAfterMs
        ? `Rate limited, retry after ${retryAfterMs}ms`
        : "Rate limited",
      "RATE_LIMITED"
    );
    this.name = "InvestingRateLimitError";
  }
}
