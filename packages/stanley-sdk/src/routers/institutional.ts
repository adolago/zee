import type { HttpTransport } from "../http";
import { LRUCache } from "../cache";
import type { ApiResponse } from "../types/common";
import type { InstitutionalHolding, OwnershipBreakdown, InstitutionalSentiment, SmartMoneyFlow, WhaleActivity } from "../types/institutional";

export class InstitutionalRouter {
  constructor(private http: HttpTransport, private cache: LRUCache) {}

  async getHoldings(symbol: string, limit = 10): Promise<ApiResponse<InstitutionalHolding[]>> {
    const key = LRUCache.key("/api/institutional", { symbol, limit });
    const cached = this.cache.get<ApiResponse<InstitutionalHolding[]>>(key);
    if (cached) return cached;

    const result = await this.http.request<InstitutionalHolding[]>(`/api/institutional/${symbol.toUpperCase()}?limit=${limit}`);
    if (result.success) this.cache.set(key, result, "FUNDAMENTAL");
    return result;
  }

  async getOwnership(symbol: string): Promise<ApiResponse<OwnershipBreakdown>> {
    const key = LRUCache.key("/api/institutional/ownership", { symbol });
    const cached = this.cache.get<ApiResponse<OwnershipBreakdown>>(key);
    if (cached) return cached;

    const result = await this.http.request<OwnershipBreakdown>(`/api/institutional/${symbol.toUpperCase()}/ownership`);
    if (result.success) this.cache.set(key, result, "FUNDAMENTAL");
    return result;
  }

  async getSentiment(symbol: string): Promise<ApiResponse<InstitutionalSentiment>> {
    return this.http.request<InstitutionalSentiment>(`/api/institutional/${symbol.toUpperCase()}/sentiment`);
  }

  async getSmartMoneyFlow(symbol: string): Promise<ApiResponse<SmartMoneyFlow>> {
    return this.http.request<SmartMoneyFlow>(`/api/institutional/${symbol.toUpperCase()}/smart-money`);
  }

  async getWhales(symbol: string): Promise<ApiResponse<WhaleActivity[]>> {
    return this.http.request<WhaleActivity[]>(`/api/institutional/${symbol.toUpperCase()}/whales`);
  }
}
