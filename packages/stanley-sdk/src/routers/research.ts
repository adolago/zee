import type { HttpTransport } from "../http";
import { LRUCache } from "../cache";
import type { ApiResponse } from "../types/common";
import type { ResearchReport, ValuationData, EarningsAnalysis, PeerComparison, DCFResult, ResearchSummary } from "../types/research";

export class ResearchRouter {
  constructor(private http: HttpTransport, private cache: LRUCache) {}

  async getReport(symbol: string): Promise<ApiResponse<ResearchReport>> {
    const key = LRUCache.key("/api/research", { symbol });
    const cached = this.cache.get<ApiResponse<ResearchReport>>(key);
    if (cached) return cached;

    const result = await this.http.request<ResearchReport>(`/api/research/${symbol.toUpperCase()}`);
    if (result.success) this.cache.set(key, result, "FUNDAMENTAL");
    return result;
  }

  async getValuation(symbol: string, includeDcf = true): Promise<ApiResponse<ValuationData>> {
    const qs = includeDcf ? "?include_dcf=true" : "";
    return this.http.request<ValuationData>(`/api/valuation/${symbol.toUpperCase()}${qs}`);
  }

  async getEarnings(symbol: string, quarters = 12): Promise<ApiResponse<EarningsAnalysis>> {
    return this.http.request<EarningsAnalysis>(`/api/earnings/${symbol.toUpperCase()}?quarters=${quarters}`);
  }

  async getPeers(symbol: string, peers?: string): Promise<ApiResponse<PeerComparison>> {
    const qs = peers ? `?peers=${peers}` : "";
    return this.http.request<PeerComparison>(`/api/peers/${symbol.toUpperCase()}${qs}`);
  }

  async getDCF(symbol: string, options?: { discountRate?: number; terminalGrowth?: number; projectionYears?: number }): Promise<ApiResponse<DCFResult>> {
    const params = new URLSearchParams();
    if (options?.discountRate) params.set("discount_rate", String(options.discountRate));
    if (options?.terminalGrowth) params.set("terminal_growth", String(options.terminalGrowth));
    if (options?.projectionYears) params.set("projection_years", String(options.projectionYears));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.http.request<DCFResult>(`/api/research/${symbol.toUpperCase()}/dcf${qs}`);
  }

  async getSummary(symbol: string): Promise<ApiResponse<ResearchSummary>> {
    return this.http.request<ResearchSummary>(`/api/research/${symbol.toUpperCase()}/summary`);
  }
}
