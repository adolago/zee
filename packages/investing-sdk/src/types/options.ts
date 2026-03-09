/** Options types */

export interface OptionsFlow {
  symbol: string;
  totalVolume: number;
  callVolume: number;
  putVolume: number;
  putCallRatio: number;
  netPremium: number;
  unusualTrades: UnusualTrade[];
  timestamp: string;
}

export interface UnusualTrade {
  symbol: string;
  type: "call" | "put";
  strike: number;
  expiry: string;
  volume: number;
  openInterest: number;
  premium: number;
  sentiment: string;
  timestamp: string;
}

export interface OptionsChain {
  symbol: string;
  expirations: string[];
  calls: OptionContract[];
  puts: OptionContract[];
  underlyingPrice: number;
}

export interface OptionContract {
  strike: number;
  expiry: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

export interface GammaExposure {
  symbol: string;
  netGamma: number;
  gammaByStrike: Array<{ strike: number; gamma: number }>;
  flipPoint?: number;
  maxPain?: number;
  timestamp: string;
}

export interface PutCallAnalysis {
  symbol: string;
  ratio: number;
  signal: string;
  historicalAvg: number;
  percentile: number;
}
