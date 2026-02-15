/**
 * WebSocket Client
 *
 * Manages WebSocket connections to Stanley's real-time data channels.
 * Connections are lazy (established on first subscriber) and close after idle timeout.
 */

import type { WsConfig } from "./config";
import type { WsChannel, WsMessage, WsSubscription } from "./types/websocket";

type WsHandler = (message: WsMessage) => void;

export class StanleyWsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<WsHandler>>();
  private subscriptions = new Map<string, WsSubscription>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private baseUrl: string;

  constructor(
    httpBaseUrl: string,
    private config: WsConfig,
  ) {
    // Convert http(s) to ws(s)
    this.baseUrl = httpBaseUrl.replace(/^http/, "ws") + "/ws";
  }

  /** Subscribe to a channel with optional symbol filter */
  subscribe(channel: WsChannel, handler: WsHandler, symbols?: string[]): () => void {
    const key = this.channelKey(channel, symbols);

    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)!.add(handler);

    // Track subscription
    this.subscriptions.set(key, { channel, symbols });

    // Ensure connected
    this.ensureConnected();
    this.resetIdleTimer();

    // Send subscribe message if connected
    if (this.connected) {
      this.sendSubscribe(channel, symbols);
    }

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(key);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(key);
          this.subscriptions.delete(key);
          if (this.connected) {
            this.sendUnsubscribe(channel, symbols);
          }
        }
      }

      // Close if no more subscribers
      if (this.handlers.size === 0) {
        this.startIdleTimer();
      }
    };
  }

  /** Close the WebSocket connection */
  close(): void {
    this.clearTimers();
    if (this.ws) {
      this.ws.close(1000, "Client closing");
      this.ws = null;
    }
    this.connected = false;
    this.handlers.clear();
    this.subscriptions.clear();
  }

  /** Whether connected */
  get isConnected(): boolean {
    return this.connected;
  }

  /** Number of active subscriptions */
  get subscriptionCount(): number {
    return this.subscriptions.size;
  }

  private ensureConnected(): void {
    if (this.ws && this.connected) return;
    if (this.ws) return; // connecting

    this.ws = new WebSocket(this.baseUrl);

    this.ws.onopen = () => {
      this.connected = true;
      // Re-subscribe to all channels
      for (const sub of this.subscriptions.values()) {
        this.sendSubscribe(sub.channel, sub.symbols);
      }
    };

    this.ws.onmessage = (event) => {
      this.resetIdleTimer();
      try {
        const message = JSON.parse(String(event.data)) as WsMessage;
        this.dispatch(message);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;

      if (this.config.autoReconnect && this.handlers.size > 0) {
        this.reconnectTimer = setTimeout(() => {
          this.ensureConnected();
        }, this.config.reconnectIntervalMs);
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private dispatch(message: WsMessage): void {
    // Dispatch to channel-specific handlers
    for (const [key, handlers] of this.handlers) {
      const sub = this.subscriptions.get(key);
      if (!sub) continue;

      if (sub.channel !== message.channel) continue;

      // If subscription has symbol filter, check it
      if (sub.symbols && sub.symbols.length > 0) {
        const msgSymbol = (message.data as Record<string, unknown>)?.symbol;
        if (typeof msgSymbol === "string" && !sub.symbols.includes(msgSymbol)) {
          continue;
        }
      }

      for (const handler of handlers) {
        try {
          handler(message);
        } catch {
          // Don't let handler errors break dispatch
        }
      }
    }
  }

  private sendSubscribe(channel: WsChannel, symbols?: string[]): void {
    this.send({ type: "subscribe", channel, symbols });
  }

  private sendUnsubscribe(channel: WsChannel, symbols?: string[]): void {
    this.send({ type: "unsubscribe", channel, symbols });
  }

  private send(data: unknown): void {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private channelKey(channel: WsChannel, symbols?: string[]): string {
    return symbols?.length ? `${channel}:${symbols.sort().join(",")}` : channel;
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.startIdleTimer();
  }

  private startIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.handlers.size === 0) {
        this.close();
      }
    }, this.config.idleTimeoutMs);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.reconnectTimer = null;
    this.idleTimer = null;
  }
}
