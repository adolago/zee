/**
 * Config Bridge
 *
 * Translates configuration between OpenCode and agent-core formats.
 */

import type { AdapterConfig } from "../types"

interface OpenCodeConfig {
  models?: {
    default?: string
    fallback?: string
  }
  agent?: {
    default?: string
    permissions?: Record<string, boolean>
  }
  instructions?: {
    system?: string
  }
  ui?: {
    theme?: string
    compact?: boolean
  }
}

interface AgentCoreConfig {
  provider?: {
    model?: string
    fallback?: string
  }
  agent?: {
    name?: string
  }
  permission?: Record<string, boolean>
  instructions?: string[]
  mode?: {
    theme?: string
    compact?: boolean
  }
}

export class ConfigBridge {
  private configCache: OpenCodeConfig | null = null
  private watchers = new Set<(config: OpenCodeConfig) => void>()
  private baseUrl: string

  constructor(private adapterConfig: AdapterConfig) {
    this.baseUrl = adapterConfig.agentCoreUrl.replace(/\/$/, "")
  }

  async initialize(): Promise<void> {
    await this.get()
  }

  async get(): Promise<OpenCodeConfig> {
    if (this.configCache) return this.configCache

    const response = await this.fetch("/config")
    this.configCache = this.transformFromAgentCore(response)
    return this.configCache
  }

  async set(config: Partial<OpenCodeConfig>): Promise<void> {
    const agentCoreConfig = this.transformToAgentCore({
      ...this.configCache,
      ...config,
    } as OpenCodeConfig)

    await this.fetch("/config", {
      method: "PUT",
      body: JSON.stringify(agentCoreConfig),
    })

    this.configCache = { ...this.configCache, ...config }
    this.notifyWatchers()
  }

  watch(callback: (config: OpenCodeConfig) => void): () => void {
    this.watchers.add(callback)
    return () => this.watchers.delete(callback)
  }

  private notifyWatchers(): void {
    if (this.configCache) {
      this.watchers.forEach((cb) => cb(this.configCache!))
    }
  }

  private transformFromAgentCore(config: AgentCoreConfig): OpenCodeConfig {
    const model = this.resolveModel(config.provider?.model)

    return {
      models: {
        default: model,
        fallback: config.provider?.fallback,
      },
      agent: {
        default: this.resolveAgent(config.agent?.name),
        permissions: config.permission,
      },
      instructions: {
        system: config.instructions?.join("\n"),
      },
      ui: {
        theme: this.adapterConfig.theme || "tui",
        compact: config.mode?.compact,
      },
    }
  }

  private transformToAgentCore(config: OpenCodeConfig): AgentCoreConfig {
    return {
      provider: {
        model: config.models?.default,
        fallback: config.models?.fallback,
      },
      agent: {
        name: this.mapAgentToPersona(config.agent?.default),
      },
      permission: config.agent?.permissions,
      instructions: config.instructions?.system?.split("\n"),
      mode: {
        theme: config.ui?.theme,
        compact: config.ui?.compact,
      },
    }
  }

  private resolveModel(modelId?: string): string {
    if (!modelId) return "anthropic/claude-sonnet-4-20250514"
    return modelId
  }

  private resolveAgent(personaName?: string): string {
    const mapping: Record<string, string> = {
      zee: "build",
      stanley: "build",
      johny: "build",
    }
    return mapping[personaName || ""] || "build"
  }

  private mapAgentToPersona(agent?: string): string {
    return this.adapterConfig.defaultPersona || "zee"
  }

  private async fetch(path: string, options?: RequestInit): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...this.adapterConfig.authHeaders,
        ...options?.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`)
    }

    return response.json()
  }
}
