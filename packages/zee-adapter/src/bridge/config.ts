/**
 * Config Bridge
 *
 * Translates configuration between OpenCode and zee formats.
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

interface ZeeDaemonConfig {
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
    this.baseUrl = adapterConfig.zeeUrl.replace(/\/$/, "")
  }

  async initialize(): Promise<void> {
    await this.get()
  }

  async get(): Promise<OpenCodeConfig> {
    if (this.configCache) return this.configCache

    const response = await this.fetch("/config")
    this.configCache = this.transformFromZee(response)
    return this.configCache
  }

  async set(config: Partial<OpenCodeConfig>): Promise<void> {
    const zeeConfig = this.transformToZee({
      ...this.configCache,
      ...config,
    } as OpenCodeConfig)

    await this.fetch("/config", {
      method: "PUT",
      body: JSON.stringify(zeeConfig),
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

  private transformFromZee(config: ZeeDaemonConfig): OpenCodeConfig {
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

  private transformToZee(config: OpenCodeConfig): ZeeDaemonConfig {
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

  private resolveAgent(_personaName?: string): string {
    return "build"
  }

  private mapAgentToPersona(_agent?: string): string {
    return "zee"
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
