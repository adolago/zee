import type { HttpTransport } from "../http";
import type { ApiResponse } from "../types/common";
import type { PortfolioHolding, PortfolioAnalytics, RiskMetrics, CorrelationResult, PerformanceAttribution, SectorExposure } from "../types/portfolio";

export class PortfolioRouter {
  constructor(private http: HttpTransport) {}

  async getAnalytics(holdings: PortfolioHolding[], benchmark = "SPY"): Promise<ApiResponse<PortfolioAnalytics>> {
    return this.http.request<PortfolioAnalytics>("/api/portfolio/analytics", {
      method: "POST",
      body: { holdings: holdings.map(h => ({ symbol: h.symbol.toUpperCase(), shares: h.shares, average_cost: h.averageCost ?? 0 })), benchmark },
    });
  }

  async getRisk(holdings: PortfolioHolding[], options?: { confidenceLevel?: number; method?: string; lookbackDays?: number }): Promise<ApiResponse<RiskMetrics>> {
    return this.http.request<RiskMetrics>("/api/portfolio/risk", {
      method: "POST",
      body: {
        holdings: holdings.map(h => ({ symbol: h.symbol.toUpperCase(), shares: h.shares, average_cost: h.averageCost ?? 0 })),
        confidence_level: options?.confidenceLevel ?? 0.95,
        method: options?.method ?? "historical",
        lookback_days: options?.lookbackDays ?? 252,
      },
    });
  }

  async getCorrelation(holdings: PortfolioHolding[], lookbackDays = 252): Promise<ApiResponse<CorrelationResult>> {
    return this.http.request<CorrelationResult>("/api/portfolio/correlation", {
      method: "POST",
      body: { holdings: holdings.map(h => ({ symbol: h.symbol.toUpperCase(), shares: h.shares })), lookback_days: lookbackDays },
    });
  }

  async getAttribution(holdings: PortfolioHolding[], period = "1M", benchmark = "SPY"): Promise<ApiResponse<PerformanceAttribution>> {
    return this.http.request<PerformanceAttribution>("/api/portfolio/attribution", {
      method: "POST",
      body: { holdings: holdings.map(h => ({ symbol: h.symbol.toUpperCase(), shares: h.shares, average_cost: h.averageCost ?? 0 })), period, benchmark },
    });
  }

  async getSectorExposure(holdings: PortfolioHolding[], benchmark = "SPY"): Promise<ApiResponse<SectorExposure>> {
    return this.http.request<SectorExposure>("/api/portfolio/sector-exposure", {
      method: "POST",
      body: { holdings: holdings.map(h => ({ symbol: h.symbol.toUpperCase(), shares: h.shares })), benchmark },
    });
  }
}
