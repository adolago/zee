import type { HttpTransport } from "../http";
import { LRUCache } from "../cache";
import type { ApiResponse } from "../types/common";
import type { MarketData, QuoteResponse, HistoricalBar, MarketOverview } from "../types/market";

export class MarketRouter {
  constructor(private http: HttpTransport, private cache: LRUCache) {}

  async getData(symbol: string): Promise<ApiResponse<MarketData>> {
    const key = LRUCache.key("/api/market", { symbol });
    const cached = this.cache.get<ApiResponse<MarketData>>(key);
    if (cached) return cached;

    const result = await this.http.request<MarketData>(`/api/market/${symbol.toUpperCase()}`);
    if (result.success) this.cache.set(key, result, "MARKET");
    return result;
  }

  async getQuote(symbol: string): Promise<ApiResponse<QuoteResponse>> {
    return this.http.request<QuoteResponse>(`/api/market/${symbol.toUpperCase()}/quote`);
  }

  async getHistory(symbol: string, period?: string, interval?: string): Promise<ApiResponse<HistoricalBar[]>> {
    const params = new URLSearchParams();
    if (period) params.set("period", period);
    if (interval) params.set("interval", interval);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.http.request<HistoricalBar[]>(`/api/market/${symbol.toUpperCase()}/history${qs}`);
  }

  async getOverview(): Promise<ApiResponse<MarketOverview>> {
    const key = "/api/market/overview";
    const cached = this.cache.get<ApiResponse<MarketOverview>>(key);
    if (cached) return cached;

    const result = await this.http.request<MarketOverview>("/api/market/overview");
    if (result.success) this.cache.set(key, result, "MARKET");
    return result;
  }
}
