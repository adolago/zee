/** Accounting and SEC filing types */

export interface Filing {
  formType: string;
  filedDate: string;
  periodEnd: string;
  description: string;
  url?: string;
}

export interface EarningsQuality {
  mScore: number;
  fScore: number;
  zScore: number;
  accrualsRatio: number;
  manipulationRisk: string;
}

export interface RedFlag {
  category: string;
  severity: string;
  description: string;
  metric?: string;
  value?: number;
}

export interface RedFlagsResponse {
  symbol: string;
  overallRisk: string;
  riskScore: number;
  flags: RedFlag[];
  timestamp: string;
}

export interface PiotroskiScore {
  symbol: string;
  score: number;
  components: Record<string, boolean>;
  interpretation: string;
}

export interface AltmanZScore {
  symbol: string;
  score: number;
  zone: string;
  components: Record<string, number>;
  interpretation: string;
}
