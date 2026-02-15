/** Trading signals types */

export interface Signal {
  signalId: string;
  symbol: string;
  signalType: string;
  strength: string;
  conviction: number;
  factors: Record<string, number>;
  priceAtSignal?: number;
  targetPrice?: number;
  stopLoss?: number;
  reasoning?: string;
  timestamp: string;
}

export interface SignalsResponse {
  signals: Signal[];
  totalRequested: number;
  signalsGenerated: number;
}

export interface BacktestRequest {
  symbols: string[];
  startDate?: string;
  endDate?: string;
  holdingPeriodDays: number;
  initialCapital: number;
}

export interface BacktestResult {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
}

export interface PerformanceStats {
  totalSignals: number;
  winRate: number;
  avgReturn: number;
  profitFactor: number;
}
