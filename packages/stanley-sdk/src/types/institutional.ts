/** Institutional holdings types */

export interface InstitutionalHolding {
  managerName: string;
  managerCik: string;
  sharesHeld: number;
  valueHeld: number;
  ownershipPercentage: number;
  changeFromLastQuarter?: number;
}

export interface OwnershipBreakdown {
  symbol: string;
  institutionalOwnership: number;
  retailOwnership: number;
  insiderOwnership: number;
  top10Concentration: number;
  totalHolders: number;
  sharesOutstanding: number;
  floatShares: number;
}

export interface InstitutionalSentiment {
  symbol: string;
  score: number;
  classification: string;
  confidence: number;
  contributingFactors: Record<string, number>;
  weightsUsed: Record<string, number>;
}

export interface SmartMoneyFlow {
  symbol: string;
  netFlow: number;
  weightedFlow: number;
  signal: string;
  signalStrength: number;
  buyersCount: number;
  sellersCount: number;
  buyingActivity: Array<Record<string, unknown>>;
  sellingActivity: Array<Record<string, unknown>>;
  coordinatedBuying: boolean;
  coordinatedSelling: boolean;
}

export interface WhaleActivity {
  managerName: string;
  action: string;
  sharesChanged: number;
  valueChanged: number;
  percentOfPortfolio: number;
  filingDate: string;
}
