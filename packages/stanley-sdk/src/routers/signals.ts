import type { HttpTransport } from "../http";
import type { ApiResponse } from "../types/common";
import type { Signal, SignalsResponse, BacktestRequest, BacktestResult, PerformanceStats } from "../types/signals";

export class SignalsRouter {
  constructor(private http: HttpTransport) {}

  async getSignal(symbol: string): Promise<ApiResponse<Signal>> {
    return this.http.request<Signal>(`/api/signals/${symbol.toUpperCase()}`);
  }

  async generate(symbols: string[], minConviction = 0.5): Promise<ApiResponse<SignalsResponse>> {
    return this.http.request<SignalsResponse>("/api/signals", {
      method: "POST",
      body: { symbols: symbols.map(s => s.toUpperCase()), min_conviction: minConviction },
    });
  }

  async backtest(request: BacktestRequest): Promise<ApiResponse<BacktestResult>> {
    return this.http.request<BacktestResult>("/api/signals/backtest", {
      method: "POST",
      body: request,
    });
  }

  async getPerformance(): Promise<ApiResponse<PerformanceStats>> {
    return this.http.request<PerformanceStats>("/api/signals/performance/stats");
  }
}
