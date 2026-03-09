/** Portfolio analytics types */

export interface PortfolioHolding {
  symbol: string;
  shares: number;
  averageCost?: number;
}

export interface PortfolioAnalytics {
  totalValue: number;
  totalCost: number;
  totalReturn: number;
  totalReturnPercent: number;
  beta: number;
  alpha: number;
  sharpeRatio: number;
  sortinoRatio: number;
  var95: number;
  var99: number;
  var95Percent: number;
  var99Percent: number;
  volatility: number;
  maxDrawdown: number;
  sectorExposure: Record<string, number>;
  topHoldings: Array<{
    symbol: string;
    shares: number;
    averageCost: number;
    currentPrice: number;
    marketValue: number;
    weight: number;
  }>;
}

export interface RiskMetrics {
  var95: number;
  var99: number;
  var95Percent: number;
  var99Percent: number;
  cvar95: number;
  cvar99: number;
  maxDrawdown: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  beta: number;
  method: string;
  lookbackDays: number;
}

export interface CorrelationResult {
  symbols: string[];
  matrix: number[][];
  highlyCorrelated: Array<{
    symbol1: string;
    symbol2: string;
    correlation: number;
  }>;
  diversificationScore: number;
}

export interface PerformanceAttribution {
  period: string;
  totalReturn: number;
  benchmarkReturn: number;
  activeReturn: number;
  bySector: Array<{ sector: string; weight: number; contribution: number }>;
  byHolding: Array<{
    symbol: string;
    weight: number;
    returnPct: number;
    contribution: number;
    sector: string;
  }>;
}

export interface SectorExposure {
  portfolioWeights: Record<string, number>;
  benchmarkWeights: Record<string, number>;
  activeWeights: Record<string, number>;
}
