/**
 * LRU + TTL Cache
 *
 * Session-scoped cache with tiered TTL based on data freshness needs.
 * Tiers: realtime (5s), market (1m), fundamental (1h), filing (24h).
 */

import type { CacheConfig } from "./config";
import { CacheTTL, type CacheTier } from "./config";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  key: string;
}

export class LRUCache {
  private entries = new Map<string, CacheEntry<unknown>>();
  private maxEntries: number;

  constructor(config: CacheConfig) {
    this.maxEntries = config.maxEntries;
  }

  /** Get cached value if not expired */
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value as T;
  }

  /** Set value with TTL tier */
  set<T>(key: string, value: T, tier: CacheTier): void {
    const ttl = CacheTTL[tier];
    if (ttl === 0) return; // NONE tier = no caching

    // Evict oldest if at capacity
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }

    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      key,
    });
  }

  /** Invalidate a specific key */
  invalidate(key: string): boolean {
    return this.entries.delete(key);
  }

  /** Invalidate all keys matching a prefix */
  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Clear all entries */
  clear(): void {
    this.entries.clear();
  }

  /** Current number of entries */
  get size(): number {
    return this.entries.size;
  }

  /** Build a cache key from endpoint and params */
  static key(endpoint: string, params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) return endpoint;
    const sorted = Object.keys(params)
      .sort()
      .map((k) => `${k}=${JSON.stringify(params[k])}`)
      .join("&");
    return `${endpoint}?${sorted}`;
  }
}
