import type { McpServer } from "@agentclientprotocol/sdk"
import type { ZeeClient } from "@zee/sdk/v2"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: string
    modelID: string
    variant?: string
  }
  variant?: string
  modeId?: string
}

export interface ACPConfig {
  sdk: ZeeClient
  url: string
  defaultModel?: {
    providerID: string
    modelID: string
  }
}
