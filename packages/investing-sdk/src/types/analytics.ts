/** Analytics types (money flow, dark pool, equity flow) */

export interface MoneyFlowData {
  symbol: string;
  netFlow1m: number;
  netFlow3m: number;
  institutionalChange: number;
  smartMoneySentiment: number;
  flowAcceleration: number;
  confidenceScore: number;
}

export interface MoneyFlowResponse {
  sectors: Record<string, MoneyFlowData>;
  netFlows: Record<string, number>;
  momentum: Record<string, number>;
  timestamp: string;
}

export interface SectorRotation {
  sector: string;
  sectorName: string;
  relativeStrength: number;
  momentumScore: number;
  flowScore: number;
  rotationPhase: string;
  recommendation: string;
  oneMonthReturn: number;
  threeMonthReturn: number;
}

export interface DarkPoolData {
  symbol: string;
  date?: string;
  darkPoolVolume: number;
  totalVolume: number;
  darkPoolPercentage: number;
  largeBlockActivity: number;
  darkPoolSignal: number;
}

export interface DarkPoolSummary {
  symbol: string;
  data: DarkPoolData[];
  summary: {
    averageDarkPoolPercentage: number;
    averageBlockActivity: number;
    totalDarkPoolVolume: number;
    signalBias: number;
  };
  timestamp: string;
}

export interface EquityFlowData {
  symbol: string;
  moneyFlowScore: number;
  institutionalSentiment: number;
  smartMoneyActivity: number;
  shortPressure: number;
  accumulationDistribution: number;
  confidence: number;
}
