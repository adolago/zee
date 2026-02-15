import type { HttpTransport } from "../http";
import type { LRUCache } from "../cache";
import type { ApiResponse } from "../types/common";
import type { EtfFlow, SectorRotationSignal, SmartBetaFactor, ThematicEtf } from "../types/etf";

export class EtfRouter {
  constructor(private http: HttpTransport, private cache: LRUCache) {}

  async getFlows(): Promise<ApiResponse<EtfFlow[]>> {
    const key = "/api/etf/flows";
    const cached = this.cache.get<ApiResponse<EtfFlow[]>>(key);
    if (cached) return cached;

    const result = await this.http.request<EtfFlow[]>("/api/etf/flows");
    if (result.success) this.cache.set(key, result, "MARKET");
    return result;
  }

  async getSectorRotation(): Promise<ApiResponse<SectorRotationSignal[]>> {
    return this.http.request<SectorRotationSignal[]>("/api/etf/sector-rotation");
  }

  async getSmartBeta(): Promise<ApiResponse<SmartBetaFactor[]>> {
    return this.http.request<SmartBetaFactor[]>("/api/etf/smart-beta");
  }

  async getThematic(): Promise<ApiResponse<ThematicEtf[]>> {
    return this.http.request<ThematicEtf[]>("/api/etf/thematic");
  }
}
