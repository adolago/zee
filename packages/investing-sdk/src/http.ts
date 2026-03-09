/**
 * HTTP Transport
 *
 * Fetch wrapper with retry, exponential backoff, timeout, and auth injection.
 */

import type { HttpConfig, AuthConfig } from "./config";
import type { ApiResponse } from "./types/common";
import {
  InvestingNetworkError,
  InvestingTimeoutError,
  InvestingAuthError,
  InvestingApiError,
  InvestingRateLimitError,
} from "./errors";
import type { AuthManager } from "./auth";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Override default timeout for this request */
  timeoutMs?: number;
  /** Skip retry logic */
  noRetry?: boolean;
}

export class HttpTransport {
  constructor(
    private baseUrl: string,
    private config: HttpConfig,
    private authManager?: AuthManager,
  ) {}

  /** Make a typed API request */
  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const { method = "GET", body, headers = {}, signal, timeoutMs, noRetry } = options;
    const url = `${this.baseUrl}${endpoint}`;

    const maxAttempts = noRetry ? 1 : this.config.maxRetries + 1;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = this.config.retryDelayMs * Math.pow(this.config.retryBackoffFactor, attempt - 1);
        await sleep(delay);
      }

      try {
        const result = await this.singleRequest<T>(url, method, body, headers, signal, timeoutMs);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on auth errors or client errors (except 429)
        if (error instanceof InvestingAuthError) throw error;
        if (error instanceof InvestingApiError && error.statusCode < 500 && error.statusCode !== 429) throw error;
        if (error instanceof InvestingTimeoutError && attempt === maxAttempts - 1) throw error;

        // Retry on 429, 5xx, network errors, timeouts
        if (error instanceof InvestingRateLimitError && error.retryAfterMs) {
          await sleep(error.retryAfterMs);
        }
      }
    }

    throw lastError ?? new InvestingNetworkError("Request failed after retries");
  }

  private async singleRequest<T>(
    url: string,
    method: string,
    body: unknown | undefined,
    extraHeaders: Record<string, string>,
    externalSignal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<ApiResponse<T>> {
    const timeout = timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();

    // Combine external abort signal with timeout
    const abortTimeout = setTimeout(() => controller.abort(), timeout);
    if (externalSignal) {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...extraHeaders,
      };

      // Inject auth
      if (this.authManager) {
        const token = await this.authManager.getToken();
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
      }

      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body !== undefined && method !== "GET") {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);

      // Handle auth errors with token refresh
      if (response.status === 401 && this.authManager) {
        const refreshed = await this.authManager.refresh();
        if (refreshed) {
          // Retry with new token
          const newToken = await this.authManager.getToken();
          if (newToken) {
            headers["Authorization"] = `Bearer ${newToken}`;
          }
          const retryResponse = await fetch(url, { ...fetchOptions, headers });
          return this.parseResponse<T>(retryResponse);
        }
      }

      return this.parseResponse<T>(response);
    } catch (error) {
      if (error instanceof InvestingApiError || error instanceof InvestingAuthError || error instanceof InvestingRateLimitError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          if (externalSignal?.aborted) {
            throw new InvestingNetworkError("Request aborted", error);
          }
          throw new InvestingTimeoutError(timeout, error);
        }
        // Network errors (connection refused, DNS, etc.)
        throw new InvestingNetworkError(error.message, error);
      }
      throw new InvestingNetworkError(String(error));
    } finally {
      clearTimeout(abortTimeout);
    }
  }

  private async parseResponse<T>(response: Response): Promise<ApiResponse<T>> {
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new InvestingRateLimitError(retryAfter ? parseInt(retryAfter) * 1000 : undefined);
    }

    if (response.status === 401 || response.status === 403) {
      const text = await response.text().catch(() => "");
      throw new InvestingAuthError(text || `HTTP ${response.status}`, response.status);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new InvestingApiError(`HTTP ${response.status}: ${text}`, response.status, text);
    }

    const data = await response.json();

    // Investing API returns { success, data, error, timestamp }
    if (typeof data === "object" && data !== null && "success" in data) {
      return data as ApiResponse<T>;
    }

    // Wrap raw responses in standard format
    return {
      success: true,
      data: data as T,
      error: null,
      timestamp: new Date().toISOString(),
    };
  }

  /** Update base URL (e.g., after daemon starts on a different port) */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
