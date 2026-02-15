import type { HttpTransport } from "../http";
import type { LRUCache } from "../cache";
import type { ApiResponse } from "../types/common";
import type { EconomicIndicator, CountrySnapshot, RegimeState, YieldCurve } from "../types/macro";

export class MacroRouter {
  constructor(private http: HttpTransport, private cache: LRUCache) {}

  async getIndicators(country = "US", category?: string): Promise<ApiResponse<EconomicIndicator[]>> {
    const params = new URLSearchParams({ country });
    if (category) params.set("category", category);
    return this.http.request<EconomicIndicator[]>(`/api/macro/indicators?${params.toString()}`);
  }

  async getSnapshot(country = "US"): Promise<ApiResponse<CountrySnapshot>> {
    return this.http.request<CountrySnapshot>(`/api/macro/snapshot/${country}`);
  }

  async getRegime(): Promise<ApiResponse<RegimeState>> {
    const key = "/api/macro/regime";
    const cached = this.cache.get<ApiResponse<RegimeState>>(key);
    if (cached) return cached;

    const result = await this.http.request<RegimeState>("/api/macro/regime");
    if (result.success) this.cache.set(key, result, "FUNDAMENTAL");
    return result;
  }

  async getYieldCurve(country = "US"): Promise<ApiResponse<YieldCurve>> {
    return this.http.request<YieldCurve>(`/api/macro/yield-curve/${country}`);
  }

  async getCalendar(): Promise<ApiResponse<Array<Record<string, unknown>>>> {
    return this.http.request<Array<Record<string, unknown>>>("/api/macro/calendar");
  }
}
