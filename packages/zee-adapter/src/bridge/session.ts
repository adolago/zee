/**
 * Session Bridge
 *
 * Translates OpenCode session operations to zee format.
 */

import type {
  AdapterConfig,
  Session,
  Message,
  MessageStream,
  MessageStreamChunk,
  CreateSessionParams,
  SessionFilters,
  ZeeSessionPayload,
} from "../types"

export class SessionBridge {
  private sessionCache = new Map<string, Session>()
  private baseUrl: string

  constructor(private config: AdapterConfig) {
    this.baseUrl = config.zeeUrl.replace(/\/$/, "")
  }

  async initialize(): Promise<void> {
    // Verify connection to zee daemon
    await this.list({ limit: 1 })
  }

  async create(params: CreateSessionParams): Promise<Session> {
    const zeeParams = {
      directory: params.workingDirectory,
      agent: this.mapAgentToPersona(params.agent),
      model: params.model,
      title: params.title,
    }

    const response = await this.fetch("/session", {
      method: "POST",
      body: JSON.stringify(zeeParams),
    })

    const session = this.transformSession(response)
    this.sessionCache.set(session.id, session)
    return session
  }

  async get(id: string): Promise<Session | null> {
    if (this.sessionCache.has(id)) {
      return this.sessionCache.get(id)!
    }

    try {
      const response = await this.fetch(`/session/${id}`)
      const session = this.transformSession(response)
      this.sessionCache.set(session.id, session)
      return session
    } catch {
      return null
    }
  }

  async list(filters?: SessionFilters): Promise<Session[]> {
    const params = new URLSearchParams()
    if (filters?.limit) params.set("limit", String(filters.limit))
    if (filters?.offset) params.set("offset", String(filters.offset))
    if (filters?.agent) params.set("agent", filters.agent)

    const url = `/session${params.toString() ? `?${params}` : ""}`
    const response = await this.fetch(url)

    return response.sessions.map((s: ZeeSessionPayload) => this.transformSession(s))
  }

  async delete(id: string): Promise<void> {
    await this.fetch(`/session/${id}`, { method: "DELETE" })
    this.sessionCache.delete(id)
  }

  async sendMessage(sessionId: string, message: Message): Promise<MessageStream> {
    const zeeMessage = {
      role: message.role,
      content: message.content,
      ...(message.tool_calls ? { toolCalls: message.tool_calls } : {}),
    }

    const response = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.config.authHeaders,
      },
      body: JSON.stringify(zeeMessage),
    })

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`)
    }

    return this.transformStream(response.body!)
  }

  private mapAgentToPersona(agent?: string): string {
    const mapping: Record<string, string> = {
      build: this.config.defaultPersona || "zee",
      plan: this.config.defaultPersona || "zee",
      general: this.config.defaultPersona || "zee",
    }
    return mapping[agent || ""] || this.config.defaultPersona || "zee"
  }

  private transformSession(info: ZeeSessionPayload): Session {
    return {
      id: info.id,
      created_at: info.time.created,
      updated_at: info.time.updated,
      agent: info.agent || "build",
      title: info.title,
      message_count: info.messageCount,
      working_directory: info.directory,
    }
  }

  private async *transformStream(
    body: ReadableStream<Uint8Array>
  ): AsyncIterable<MessageStreamChunk> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (!line.trim() || !line.startsWith("data: ")) continue

        try {
          const data = JSON.parse(line.slice(6))
          yield {
            type: data.type,
            content: data.text || data.content,
            tool_call: data.toolCall,
            tool_result: data.toolResult,
            done: data.type === "finish",
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  }

  private async fetch(path: string, options?: RequestInit): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...this.config.authHeaders,
        ...options?.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`)
    }

    return response.json()
  }
}
