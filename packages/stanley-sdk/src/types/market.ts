/** Market data types */

export interface MarketData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume?: number;
  marketCap?: number;
  peRatio?: number;
  dividendYield?: number;
  high52w?: number;
  low52w?: number;
  timestamp?: string;
}

export interface QuoteResponse {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  timestamp: string;
}

export interface HistoricalBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

export interface MarketOverview {
  indices: Record<string, MarketData>;
  sectors: Record<string, number>;
  breadth: MarketBreadth;
  timestamp: string;
}

export interface MarketBreadth {
  advanceDeclineRatio: number;
  advancingVolume: number;
  decliningVolume: number;
  newHighsNewLows: number;
  percentAbove50DMA: number;
  percentAbove200DMA: number;
  mcclellanOscillator: number;
  breadthThrust: number;
  interpretation: string;
  timestamp: string;
}
