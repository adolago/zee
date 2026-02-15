/** Notes and research vault types */

export interface NoteResponse {
  name: string;
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

export interface ThesisFrontmatter {
  title: string;
  symbol: string;
  companyName?: string;
  sector?: string;
  status: string;
  conviction: string;
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
}

export interface TradeFrontmatter {
  title: string;
  symbol: string;
  direction: string;
  status: string;
  entryPrice: number;
  exitPrice?: number;
  shares: number;
  pnl?: number;
  pnlPercent?: number;
}

export interface TradeStatsResponse {
  totalTrades: number;
  winners: number;
  losers: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

export interface SearchResult {
  path: string;
  name: string;
  title: string;
  noteType: string;
  snippet: string;
}

export interface GraphResponse {
  nodes: Array<{
    id: string;
    label: string;
    nodeType: string;
    tags: string[];
  }>;
  edges: Array<{
    source: string;
    target: string;
  }>;
}

export interface CreateThesisRequest {
  symbol: string;
  companyName?: string;
  sector?: string;
  conviction: string;
}

export interface CreateTradeRequest {
  symbol: string;
  direction: string;
  entryPrice: number;
  shares: number;
  entryDate?: string;
}
