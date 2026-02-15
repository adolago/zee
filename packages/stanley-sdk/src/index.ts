/**
 * @stanley/sdk — TypeScript SDK for Stanley Investment Platform
 *
 * Usage:
 *   import { StanleyClient } from "@stanley/sdk";
 *
 *   const client = new StanleyClient({ daemon: { autoStart: true } });
 *   await client.connect();
 *   const quote = await client.market.getData("AAPL");
 *   await client.disconnect();
 */

// Main client
export { StanleyClient, type StanleyClientConfig } from "./client";

// Configuration
export {
  type StanleySDKConfig,
  type DaemonConfig,
  type HttpConfig,
  type AuthConfig,
  type CacheConfig,
  type WsConfig,
  type CacheTier,
  CacheTTL,
  DEFAULT_CONFIG,
  resolveConfig,
} from "./config";

// Error hierarchy
export {
  StanleyError,
  StanleyNetworkError,
  StanleyTimeoutError,
  StanleyAuthError,
  StanleyApiError,
  StanleyNotRunningError,
  StanleyDaemonError,
  StanleyRateLimitError,
} from "./errors";

// Infrastructure (for advanced usage)
export { HttpTransport, type RequestOptions } from "./http";
export { AuthManager } from "./auth";
export { LRUCache } from "./cache";
export { StanleyDaemon } from "./daemon";
export { StanleyWsClient } from "./ws";
export {
  MemoryBridge,
  type MemoryBackend,
  type MemoryEntry,
  type MemoryLocation,
  type PersistRule,
  DEFAULT_PERSIST_RULES,
} from "./memory-bridge";

// Routers (for direct construction)
export { SystemRouter } from "./routers/system";
export { MarketRouter } from "./routers/market";
export { InstitutionalRouter } from "./routers/institutional";
export { AnalyticsRouter } from "./routers/analytics";
export { PortfolioRouter } from "./routers/portfolio";
export { ResearchRouter } from "./routers/research";
export { CommoditiesRouter } from "./routers/commodities";
export { OptionsRouter } from "./routers/options";
export { EtfRouter } from "./routers/etf";
export { MacroRouter } from "./routers/macro";
export { AccountingRouter } from "./routers/accounting";
export { SignalsRouter } from "./routers/signals";
export { NotesRouter } from "./routers/notes";

// Types (re-export all)
export * from "./types/common";
export * from "./types/market";
export * from "./types/institutional";
export * from "./types/analytics";
export * from "./types/portfolio";
export * from "./types/research";
export * from "./types/commodities";
export * from "./types/options";
export * from "./types/etf";
export * from "./types/macro";
export * from "./types/accounting";
export * from "./types/signals";
export * from "./types/notes";
export * from "./types/websocket";
export * from "./types/system";
