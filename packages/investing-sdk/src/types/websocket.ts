/** WebSocket message types */

export type WsChannel = "market" | "signals" | "portfolio" | "bars" | "options_flow" | "dark_pool";

export interface WsMessage<T = unknown> {
  channel: WsChannel;
  event: string;
  data: T;
  timestamp: string;
}

export interface WsSubscription {
  channel: WsChannel;
  symbols?: string[];
  filters?: Record<string, unknown>;
}

export interface MarketTick {
  symbol: string;
  price: number;
  volume: number;
  timestamp: string;
}

export interface SignalAlert {
  signalId: string;
  symbol: string;
  type: string;
  conviction: number;
  message: string;
  timestamp: string;
}
