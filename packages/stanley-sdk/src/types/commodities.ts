/** Commodities types */

export interface CommodityPrice {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  openInterest: number;
  timestamp: string;
}

export interface CommoditySummary {
  symbol: string;
  name: string;
  category: string;
  price: number;
  change1d: number;
  change1w: number;
  change1m: number;
  changeYtd: number;
  volatility30d: number;
  trend: string;
  relativeStrength: number;
}

export interface CategoryOverview {
  category: string;
  count: number;
  avgChange: number;
  leader?: CommodityPrice;
  laggard?: CommodityPrice;
  commodities: CommodityPrice[];
}

export interface CommoditiesOverview {
  timestamp: string;
  sentiment: string;
  avgChange: number;
  categories: Record<string, CategoryOverview>;
}

export interface MacroLinkage {
  commodity: string;
  macroIndicator: string;
  correlation: number;
  leadLagDays: number;
  relationship: string;
  strength: string;
}

export interface MacroAnalysis {
  commodity: string;
  name: string;
  category: string;
  linkages: MacroLinkage[];
  primaryDriver?: string;
}

export interface CorrelationMatrix {
  symbols: string[];
  matrix: number[][];
}
