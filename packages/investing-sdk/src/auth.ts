/**
 * Auth Manager
 *
 * JWT token lifecycle with deduped refresh to prevent concurrent 401 storms.
 */

import type { AuthConfig } from "./config";

export class AuthManager {
  private token: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(private config: AuthConfig) {
    // Initialize from config
    if (config.apiKey) {
      this.token = config.apiKey;
    } else if (config.jwtToken) {
      this.token = config.jwtToken;
    }
  }

  /** Get current auth token (API key or JWT) */
  async getToken(): Promise<string | null> {
    return this.token;
  }

  /** Set token directly */
  setToken(token: string): void {
    this.token = token;
  }

  /** Whether auth is configured */
  get isConfigured(): boolean {
    return !!(this.config.apiKey || this.config.jwtToken || this.token);
  }

  /**
   * Refresh JWT token. Dedupes concurrent refresh calls —
   * if a refresh is already inflight, returns the same promise.
   */
  async refresh(): Promise<boolean> {
    if (!this.config.refreshUrl) return false;

    // Dedup: return existing inflight promise
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.doRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<boolean> {
    if (!this.config.refreshUrl || !this.token) return false;

    try {
      const response = await fetch(this.config.refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!response.ok) return false;

      const data = await response.json() as { token?: string; access_token?: string };
      const newToken = data.token || data.access_token;

      if (newToken) {
        this.token = newToken;
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /** Build auth headers for requests */
  getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.config.apiKey) {
      headers["X-API-Key"] = this.config.apiKey;
    } else if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    return headers;
  }
}
