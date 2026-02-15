import type { HttpTransport } from "../http";
import type { LRUCache } from "../cache";
import type { ApiResponse } from "../types/common";
import type { CommoditiesOverview, CommoditySummary, CorrelationMatrix, MacroAnalysis } from "../types/commodities";

export class CommoditiesRouter {
  constructor(private http: HttpTransport, private cache: LRUCache) {}

  async getOverview(): Promise<ApiResponse<CommoditiesOverview>> {
    const key = "/api/commodities";
    const cached = this.cache.get<ApiResponse<CommoditiesOverview>>(key);
    if (cached) return cached;

    const result = await this.http.request<CommoditiesOverview>("/api/commodities");
    if (result.success) this.cache.set(key, result, "MARKET");
    return result;
  }

  async getDetail(symbol: string): Promise<ApiResponse<CommoditySummary>> {
    return this.http.request<CommoditySummary>(`/api/commodities/${symbol.toUpperCase()}`);
  }

  async getCorrelations(): Promise<ApiResponse<CorrelationMatrix>> {
    const key = "/api/commodities/correlations";
    const cached = this.cache.get<ApiResponse<CorrelationMatrix>>(key);
    if (cached) return cached;

    const result = await this.http.request<CorrelationMatrix>("/api/commodities/correlations");
    if (result.success) this.cache.set(key, result, "FUNDAMENTAL");
    return result;
  }

  async getMacroLinkages(symbol: string): Promise<ApiResponse<MacroAnalysis>> {
    return this.http.request<MacroAnalysis>(`/api/commodities/${symbol.toUpperCase()}/macro`);
  }
}
