/**
 * Stanley SDK Configuration
 */

/** Cache TTL tiers based on data freshness needs */
export const CacheTTL = {
  /** Real-time data: 5 seconds */
  REALTIME: 5_000,
  /** Market data: 1 minute */
  MARKET: 60_000,
  /** Fundamental data: 1 hour */
  FUNDAMENTAL: 3_600_000,
  /** Filing/SEC data: 24 hours */
  FILING: 86_400_000,
  /** No caching */
  NONE: 0,
} as const;

export type CacheTier = keyof typeof CacheTTL;

/** Daemon configuration */
export interface DaemonConfig {
  /** Auto-start Stanley API if not running (default: true) */
  autoStart: boolean;
  /** Auto-restart on crash (default: true) */
  autoRestart: boolean;
  /** Stanley core executable path used for local daemon startup */
  coreBin?: string;
  /** Path to Stanley repo (auto-detected if not set) */
  repoPath?: string;
  /** Startup timeout in ms (default: 30000) */
  startupTimeoutMs: number;
  /** Health poll interval during startup in ms (default: 500) */
  healthPollIntervalMs: number;
  /** Port for the API server (default: 8000) */
  port: number;
  /** Host for the API server (default: "127.0.0.1") */
  host: string;
}

/** HTTP transport configuration */
export interface HttpConfig {
  /** Request timeout in ms (default: 30000) */
  timeoutMs: number;
  /** Max retry attempts on 429/5xx (default: 3) */
  maxRetries: number;
  /** Initial retry delay in ms (default: 1000) */
  retryDelayMs: number;
  /** Retry backoff factor (default: 2) */
  retryBackoffFactor: number;
}

/** Auth configuration */
export interface AuthConfig {
  /** API key for local auth */
  apiKey?: string;
  /** JWT token (for multi-user) */
  jwtToken?: string;
  /** Token refresh URL */
  refreshUrl?: string;
}

/** Cache configuration */
export interface CacheConfig {
  /** Enable caching (default: true) */
  enabled: boolean;
  /** Max entries in LRU cache (default: 500) */
  maxEntries: number;
}

/** WebSocket configuration */
export interface WsConfig {
  /** Enable WebSocket connections (default: false) */
  enabled: boolean;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect: boolean;
  /** Reconnect interval in ms (default: 5000) */
  reconnectIntervalMs: number;
  /** Idle timeout before closing connection in ms (default: 300000 = 5min) */
  idleTimeoutMs: number;
}

/** Full SDK configuration */
export interface StanleySDKConfig {
  /** Base URL for Stanley API (default: "http://127.0.0.1:8000") */
  baseUrl: string;
  /** Daemon configuration */
  daemon: DaemonConfig;
  /** HTTP transport configuration */
  http: HttpConfig;
  /** Authentication configuration */
  auth: AuthConfig;
  /** Cache configuration */
  cache: CacheConfig;
  /** WebSocket configuration */
  ws: WsConfig;
}

/** Default configuration */
export const DEFAULT_CONFIG: StanleySDKConfig = {
  baseUrl: "http://127.0.0.1:8000",
  daemon: {
    autoStart: true,
    autoRestart: true,
    coreBin: undefined,
    startupTimeoutMs: 30_000,
    healthPollIntervalMs: 500,
    port: 8000,
    host: "127.0.0.1",
  },
  http: {
    timeoutMs: 30_000,
    maxRetries: 3,
    retryDelayMs: 1_000,
    retryBackoffFactor: 2,
  },
  auth: {},
  cache: {
    enabled: true,
    maxEntries: 500,
  },
  ws: {
    enabled: false,
    autoReconnect: true,
    reconnectIntervalMs: 5_000,
    idleTimeoutMs: 300_000,
  },
};

/** Partial config type for constructor convenience */
export type PartialSDKConfig = Omit<Partial<StanleySDKConfig>, "daemon" | "http" | "auth" | "cache" | "ws"> & {
  daemon?: Partial<DaemonConfig>;
  http?: Partial<HttpConfig>;
  auth?: Partial<AuthConfig>;
  cache?: Partial<CacheConfig>;
  ws?: Partial<WsConfig>;
};

/** Deep merge partial config with defaults */
export function resolveConfig(partial?: PartialSDKConfig): StanleySDKConfig {
  if (!partial) return { ...DEFAULT_CONFIG };
  return {
    baseUrl: partial.baseUrl ?? DEFAULT_CONFIG.baseUrl,
    daemon: { ...DEFAULT_CONFIG.daemon, ...partial.daemon },
    http: { ...DEFAULT_CONFIG.http, ...partial.http },
    auth: { ...DEFAULT_CONFIG.auth, ...partial.auth },
    cache: { ...DEFAULT_CONFIG.cache, ...partial.cache },
    ws: { ...DEFAULT_CONFIG.ws, ...partial.ws },
  };
}
