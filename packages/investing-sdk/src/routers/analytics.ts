import type { HttpTransport } from "../http";
import type { LRUCache } from "../cache";
import type { ApiResponse } from "../types/common";
import type { MoneyFlowResponse, SectorRotation, DarkPoolSummary, EquityFlowData } from "../types/analytics";

export class AnalyticsRouter {
  constructor(private http: HttpTransport, private cache: LRUCache) {}

  async getMoneyFlow(sectors: string[], lookbackDays = 63): Promise<ApiResponse<MoneyFlowResponse>> {
    return this.http.request<MoneyFlowResponse>("/api/money-flow", {
      method: "POST",
      body: { sectors, lookback_days: lookbackDays },
    });
  }

  async getDarkPool(symbol: string): Promise<ApiResponse<DarkPoolSummary>> {
    return this.http.request<DarkPoolSummary>(`/api/dark-pool/${symbol.toUpperCase()}`);
  }

  async getEquityFlow(symbol: string): Promise<ApiResponse<EquityFlowData>> {
    return this.http.request<EquityFlowData>(`/api/equity-flow/${symbol.toUpperCase()}`);
  }

  async getSectorRotation(): Promise<ApiResponse<SectorRotation[]>> {
    const key = "/api/analytics/sector-rotation";
    const cached = this.cache.get<ApiResponse<SectorRotation[]>>(key);
    if (cached) return cached;

    const result = await this.http.request<SectorRotation[]>("/api/analytics/sector-rotation");
    if (result.success) this.cache.set(key, result, "MARKET");
    return result;
  }
}
