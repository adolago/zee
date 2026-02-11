/**
 * Main OpenCode Adapter
 *
 * Orchestrates bridges between OpenCode Web UI and zee daemon.
 */

import { SessionBridge } from "./bridge/session"
import { ToolBridge } from "./bridge/tool"
import { ConfigBridge } from "./bridge/config"
import type { AdapterConfig, Session } from "./types"

export class OpenCodeAdapter {
  readonly session: SessionBridge
  readonly tool: ToolBridge
  readonly config: ConfigBridge

  private eventHandlers = new Map<string, Set<Function>>()

  constructor(private readonly adapterConfig: AdapterConfig) {
    this.session = new SessionBridge(adapterConfig)
    this.tool = new ToolBridge(adapterConfig)
    this.config = new ConfigBridge(adapterConfig)
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.session.initialize(),
      this.tool.initialize(),
      this.config.initialize(),
    ])
  }

  async shutdown(): Promise<void> {
    this.eventHandlers.clear()
  }

  on(event: "error", handler: (error: Error) => void): void
  on(event: "sessionUpdate", handler: (session: Session) => void): void
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  off(event: string, handler: Function): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  protected emit(event: string, data: unknown): void {
    this.eventHandlers.get(event)?.forEach((handler) => handler(data))
  }
}

export function createAdapter(config: AdapterConfig): OpenCodeAdapter {
  return new OpenCodeAdapter(config)
}
