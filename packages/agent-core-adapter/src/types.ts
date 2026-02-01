/**
 * Type definitions for OpenCode Adapter
 */

export interface AdapterConfig {
  agentCoreUrl: string
  authHeaders?: Record<string, string>
  defaultPersona?: "zee" | "stanley" | "johny"
  theme?: "tui" | "opencode" | "auto"
}

export interface Session {
  id: string
  created_at: string
  updated_at: string
  agent: string
  title: string
  message_count: number
  working_directory: string
}

export interface Message {
  role: "user" | "assistant"
  content: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface MessageStreamChunk {
  type: "text" | "tool_call" | "tool_result" | "finish" | "error"
  content?: string
  tool_call?: ToolCall
  tool_result?: ToolResult
  done: boolean
}

export type MessageStream = AsyncIterable<MessageStreamChunk>

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
  duration_ms?: number
}

export interface CreateSessionParams {
  workingDirectory: string
  agent?: string
  model?: string
  title?: string
}

export interface SessionFilters {
  limit?: number
  offset?: number
  agent?: string
}

export interface PermissionContext {
  sessionId: string
  workingDirectory: string
}

export interface AgentCoreSession {
  id: string
  time: {
    created: string
    updated: string
  }
  agent?: string
  title: string
  messageCount: number
  directory: string
}

export interface AgentCoreMessage {
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
}

export interface AgentCoreStreamChunk {
  type: string
  text?: string
  content?: string
  toolCall?: ToolCall
}

export interface AgentCoreToolResult {
  success: boolean
  output: string
  error?: string
  duration?: number
}
