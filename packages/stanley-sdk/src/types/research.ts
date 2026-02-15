/** Research and valuation types */

export interface ResearchReport {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  currentPrice: number;
  marketCap: number;
  valuation: Record<string, unknown>;
  dcf?: Record<string, unknown>;
  fairValueRange: { low: number; high: number };
  valuationRating: string;
  earnings: Record<string, unknown>;
  earningsQualityScore: number;
  revenueGrowth5yr: number;
  epsGrowth5yr: number;
  grossMargin: number;
  operatingMargin: number;
  netMargin: number;
  roe: number;
  roic: number;
  debtToEquity: number;
  currentRatio: number;
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  catalysts: string[];
  risks: string[];
}

export interface ValuationData {
  symbol: string;
  method: string;
  valuation: Record<string, unknown>;
  dcf?: Record<string, unknown>;
  sensitivity?: Record<string, unknown>;
  fairValue?: number;
  currentPrice?: number;
  upsidePercent?: number;
  assumptions?: Record<string, unknown>;
}

export interface EarningsAnalysis {
  symbol: string;
  quarters: Array<Record<string, unknown>>;
  epsGrowthYoy: number;
  epsGrowth3yrCagr: number;
  avgEpsSurprisePercent: number;
  beatRate: number;
  consecutiveBeats: number;
  earningsVolatility: number;
  earningsConsistency: number;
}

export interface PeerComparison {
  target: Record<string, unknown>;
  peerAverages: Record<string, number>;
  premiumDiscount: Record<string, number>;
  peers: Array<Record<string, unknown>>;
  fairValueRange?: { low: number; high: number };
}

export interface DCFResult {
  symbol: string;
  dcf: {
    intrinsicValue: number;
    currentPrice: number;
    upsidePercentage: number;
    marginOfSafety: number;
    discountRate: number;
    terminalGrowthRate: number;
    projectionYears: number;
    pvCashFlows: number;
    pvTerminalValue: number;
    netDebt: number;
    sharesOutstanding: number;
  };
  sensitivity?: Record<string, unknown>;
  assumptions: Record<string, unknown>;
}

export interface ResearchSummary {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  currentPrice: number;
  marketCap: number;
  valuationRating: string;
  overallScore: number;
  keyMetrics: Record<string, number | null>;
  growth: Record<string, number>;
  margins: Record<string, number>;
  fairValueRange: { low: number; high: number };
  topStrengths: string[];
  topRisks: string[];
}
