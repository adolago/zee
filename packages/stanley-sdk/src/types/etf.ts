/** ETF types */

export interface EtfFlow {
  symbol: string;
  name: string;
  flow1d: number;
  flow1w: number;
  flow1m: number;
  flowPct: number;
  aum: number;
}

export interface SectorRotationSignal {
  sector: string;
  etf: string;
  momentumScore: number;
  signal: string;
  relativeStrength: number;
}

export interface SmartBetaFactor {
  factor: string;
  etfs: string[];
  totalAum: number;
  netFlow1m: number;
  performance: number;
  crowding: number;
}

export interface ThematicEtf {
  theme: string;
  etfs: string[];
  totalAum: number;
  netFlow1m: number;
  momentum: number;
  trend: string;
}
