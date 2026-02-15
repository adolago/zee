import type { HttpTransport } from "../http";
import type { ApiResponse } from "../types/common";
import type { OptionsFlow, OptionsChain, GammaExposure, PutCallAnalysis, UnusualTrade } from "../types/options";

export class OptionsRouter {
  constructor(private http: HttpTransport) {}

  async getFlow(symbol: string): Promise<ApiResponse<OptionsFlow>> {
    return this.http.request<OptionsFlow>(`/api/options/${symbol.toUpperCase()}/flow`);
  }

  async getChain(symbol: string, expiry?: string): Promise<ApiResponse<OptionsChain>> {
    const qs = expiry ? `?expiry=${expiry}` : "";
    return this.http.request<OptionsChain>(`/api/options/${symbol.toUpperCase()}/chain${qs}`);
  }

  async getGamma(symbol: string): Promise<ApiResponse<GammaExposure>> {
    return this.http.request<GammaExposure>(`/api/options/${symbol.toUpperCase()}/gamma`);
  }

  async getUnusualActivity(symbol?: string): Promise<ApiResponse<UnusualTrade[]>> {
    const path = symbol ? `/api/options/${symbol.toUpperCase()}/unusual` : "/api/options/unusual";
    return this.http.request<UnusualTrade[]>(path);
  }

  async getPutCallRatio(symbol: string): Promise<ApiResponse<PutCallAnalysis>> {
    return this.http.request<PutCallAnalysis>(`/api/options/${symbol.toUpperCase()}/put-call`);
  }

  async getMaxPain(symbol: string, expiry?: string): Promise<ApiResponse<{ strike: number; value: number }>> {
    const qs = expiry ? `?expiry=${expiry}` : "";
    return this.http.request<{ strike: number; value: number }>(`/api/options/${symbol.toUpperCase()}/max-pain${qs}`);
  }
}
