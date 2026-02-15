/**
 * Stanley SDK Error Hierarchy
 */

/** Base error for all Stanley SDK errors */
export class StanleyError extends Error {
  constructor(message: string, public readonly code: string, public override readonly cause?: Error) {
    super(message);
    this.name = "StanleyError";
  }
}

/** Network-level errors (DNS, connection refused, etc.) */
export class StanleyNetworkError extends StanleyError {
  constructor(message: string, cause?: Error) {
    super(message, "NETWORK_ERROR", cause);
    this.name = "StanleyNetworkError";
  }
}

/** Request timeout */
export class StanleyTimeoutError extends StanleyError {
  constructor(public readonly timeoutMs: number, cause?: Error) {
    super(`Request timed out after ${timeoutMs}ms`, "TIMEOUT", cause);
    this.name = "StanleyTimeoutError";
  }
}

/** Authentication/authorization errors (401, 403) */
export class StanleyAuthError extends StanleyError {
  constructor(message: string, public readonly statusCode: number = 401) {
    super(message, "AUTH_ERROR");
    this.name = "StanleyAuthError";
  }
}

/** API errors (4xx, 5xx) */
export class StanleyApiError extends StanleyError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string
  ) {
    super(message, "API_ERROR");
    this.name = "StanleyApiError";
  }
}

/** Stanley server is not running */
export class StanleyNotRunningError extends StanleyError {
  constructor(public readonly baseUrl: string) {
    super(`Stanley API not running at ${baseUrl}`, "NOT_RUNNING");
    this.name = "StanleyNotRunningError";
  }
}

/** Daemon lifecycle errors */
export class StanleyDaemonError extends StanleyError {
  constructor(message: string, cause?: Error) {
    super(message, "DAEMON_ERROR", cause);
    this.name = "StanleyDaemonError";
  }
}

/** Rate limited (429) */
export class StanleyRateLimitError extends StanleyError {
  constructor(public readonly retryAfterMs?: number) {
    super(
      retryAfterMs
        ? `Rate limited, retry after ${retryAfterMs}ms`
        : "Rate limited",
      "RATE_LIMITED"
    );
    this.name = "StanleyRateLimitError";
  }
}
