/** Macroeconomic types */

export interface EconomicIndicator {
  code: string;
  name: string;
  value: number;
  previousValue?: number;
  change?: number;
  unit: string;
  frequency: string;
  lastUpdate: string;
  source: string;
}

export interface CountrySnapshot {
  country: string;
  gdpGrowth?: number;
  inflation?: number;
  unemployment?: number;
  policyRate?: number;
  currentAccount?: number;
  regime?: string;
  timestamp: string;
}

export interface RegimeState {
  currentRegime: string;
  confidence: string;
  regimeScore: number;
  components: Record<string, string>;
  metrics: Record<string, number | null>;
  risk: Record<string, unknown>;
  positioning: {
    equity: string;
    duration: string;
    credit: string;
    volatility: string;
  };
  signals: Array<{
    source: string;
    signal: string;
    strength: number;
    confidence: number;
    details: Record<string, unknown>;
  }>;
  regimeDurationDays: number;
  timestamp: string;
}

export interface YieldCurve {
  country: string;
  shape: string;
  spread2y10y?: number;
  spread3m10y?: number;
  recessionSignal: string;
  recessionProbability12m: number;
  inversionDurationDays: number;
  curve: Array<{
    tenor: string;
    yield: number;
    priorYield?: number;
    change?: number;
  }>;
  dynamic: string;
  timestamp: string;
}
