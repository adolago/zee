import type { HttpTransport } from "../http";
import { LRUCache } from "../cache";
import type { ApiResponse } from "../types/common";
import type { Filing, EarningsQuality, RedFlagsResponse, PiotroskiScore, AltmanZScore } from "../types/accounting";

export class AccountingRouter {
  constructor(private http: HttpTransport, private cache: LRUCache) {}

  async getFilings(symbol: string): Promise<ApiResponse<Filing[]>> {
    const key = LRUCache.key("/api/accounting/filings", { symbol });
    const cached = this.cache.get<ApiResponse<Filing[]>>(key);
    if (cached) return cached;

    const result = await this.http.request<Filing[]>(`/api/accounting/${symbol.toUpperCase()}/filings`);
    if (result.success) this.cache.set(key, result, "FILING");
    return result;
  }

  async getQuality(symbol: string): Promise<ApiResponse<EarningsQuality>> {
    return this.http.request<EarningsQuality>(`/api/accounting/${symbol.toUpperCase()}/quality`);
  }

  async getRedFlags(symbol: string): Promise<ApiResponse<RedFlagsResponse>> {
    return this.http.request<RedFlagsResponse>(`/api/accounting/${symbol.toUpperCase()}/red-flags`);
  }

  async getPiotroski(symbol: string): Promise<ApiResponse<PiotroskiScore>> {
    return this.http.request<PiotroskiScore>(`/api/accounting/${symbol.toUpperCase()}/piotroski`);
  }

  async getAltman(symbol: string): Promise<ApiResponse<AltmanZScore>> {
    return this.http.request<AltmanZScore>(`/api/accounting/${symbol.toUpperCase()}/altman`);
  }
}
