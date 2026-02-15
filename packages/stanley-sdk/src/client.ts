/**
 * StanleyClient — Main SDK Entry Point
 *
 * Wires together daemon lifecycle, HTTP transport, auth, cache,
 * WebSocket, and all domain routers into a single client instance.
 *
 * Usage:
 *   const client = new StanleyClient({ daemon: { autoStart: true } });
 *   await client.connect();
 *   const quote = await client.market.getData("AAPL");
 *   await client.disconnect();
 */

import {
  type StanleySDKConfig,
  type PartialSDKConfig,
  resolveConfig,
} from "./config";
import { HttpTransport } from "./http";
import { AuthManager } from "./auth";
import { LRUCache } from "./cache";
import { StanleyDaemon } from "./daemon";
import { StanleyWsClient } from "./ws";
import { MemoryBridge } from "./memory-bridge";

// Routers
import { SystemRouter } from "./routers/system";
import { MarketRouter } from "./routers/market";
import { InstitutionalRouter } from "./routers/institutional";
import { AnalyticsRouter } from "./routers/analytics";
import { PortfolioRouter } from "./routers/portfolio";
import { ResearchRouter } from "./routers/research";
import { CommoditiesRouter } from "./routers/commodities";
import { OptionsRouter } from "./routers/options";
import { EtfRouter } from "./routers/etf";
import { MacroRouter } from "./routers/macro";
import { AccountingRouter } from "./routers/accounting";
import { SignalsRouter } from "./routers/signals";
import { NotesRouter } from "./routers/notes";

/** Re-export partial config type for constructor convenience */
export type StanleyClientConfig = PartialSDKConfig;

export class StanleyClient {
  private config: StanleySDKConfig;
  private daemon: StanleyDaemon;
  private authManager: AuthManager;
  private http: HttpTransport;
  private cache: LRUCache;
  private wsClient: StanleyWsClient | null = null;

  /** Memory bridge for auto-persisting results */
  readonly memory: MemoryBridge;

  // Domain routers — public readonly access
  readonly system: SystemRouter;
  readonly market: MarketRouter;
  readonly institutional: InstitutionalRouter;
  readonly analytics: AnalyticsRouter;
  readonly portfolio: PortfolioRouter;
  readonly research: ResearchRouter;
  readonly commodities: CommoditiesRouter;
  readonly options: OptionsRouter;
  readonly etf: EtfRouter;
  readonly macro: MacroRouter;
  readonly accounting: AccountingRouter;
  readonly signals: SignalsRouter;
  readonly notes: NotesRouter;

  constructor(config?: StanleyClientConfig) {
    this.config = resolveConfig(config);

    // Initialize infrastructure
    this.daemon = new StanleyDaemon(this.config.daemon);
    this.authManager = new AuthManager(this.config.auth);
    this.http = new HttpTransport(this.config.baseUrl, this.config.http, this.authManager);
    this.cache = new LRUCache(this.config.cache);
    this.memory = new MemoryBridge();

    // Initialize routers
    this.system = new SystemRouter(this.http);
    this.market = new MarketRouter(this.http, this.cache);
    this.institutional = new InstitutionalRouter(this.http, this.cache);
    this.analytics = new AnalyticsRouter(this.http, this.cache);
    this.portfolio = new PortfolioRouter(this.http);
    this.research = new ResearchRouter(this.http, this.cache);
    this.commodities = new CommoditiesRouter(this.http, this.cache);
    this.options = new OptionsRouter(this.http);
    this.etf = new EtfRouter(this.http, this.cache);
    this.macro = new MacroRouter(this.http, this.cache);
    this.accounting = new AccountingRouter(this.http, this.cache);
    this.signals = new SignalsRouter(this.http);
    this.notes = new NotesRouter(this.http);
  }

  /**
   * Connect to Stanley API.
   * Ensures the daemon is running (auto-starts if configured).
   */
  async connect(): Promise<void> {
    await this.daemon.ensureRunning();

    // Initialize WebSocket if enabled
    if (this.config.ws.enabled) {
      this.wsClient = new StanleyWsClient(this.config.baseUrl, this.config.ws);
    }
  }

  /**
   * Disconnect from Stanley API.
   * Closes WebSocket connections but does NOT stop the daemon
   * (other clients may be using it).
   */
  async disconnect(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    this.cache.clear();
  }

  /**
   * Stop the Stanley daemon process.
   * Only call this if you own the daemon lifecycle.
   */
  async stopDaemon(): Promise<void> {
    await this.daemon.stop();
  }

  /** Check if the Stanley API is healthy */
  async isHealthy(): Promise<boolean> {
    return this.daemon.isHealthy();
  }

  /** Get the WebSocket client (null if WS not enabled) */
  get ws(): StanleyWsClient | null {
    return this.wsClient;
  }

  /** Get the underlying HTTP transport (for advanced usage) */
  get transport(): HttpTransport {
    return this.http;
  }

  /** Get current config */
  get sdkConfig(): Readonly<StanleySDKConfig> {
    return this.config;
  }

  /** Get the base URL */
  get baseUrl(): string {
    return this.config.baseUrl;
  }

  /** Invalidate cache entries matching a prefix */
  invalidateCache(prefix?: string): void {
    if (prefix) {
      this.cache.invalidatePrefix(prefix);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Make a raw API request (escape hatch).
   * Use this for endpoints not yet covered by routers.
   */
  async rawRequest<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<{ success: boolean; data: T | null; error: string | null; timestamp: string }> {
    return this.http.request<T>(path, {
      method,
      body: options?.body,
      headers: options?.headers,
    });
  }
}
