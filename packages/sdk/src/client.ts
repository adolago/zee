export type ClientConfig = {
  baseUrl?: string
  directory?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
}

/**
 * Creates a Zee API client
 * This is a simplified client for the Zee daemon HTTP API
 */
export function createZeeClient(config?: ClientConfig) {
  const baseUrl = config?.baseUrl ?? "http://127.0.0.1:3210"

  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config?.headers ?? {}),
  }

  if (config?.directory) {
    const isNonASCII = /[^\x00-\x7F]/.test(config.directory)
    const encodedDirectory = isNonASCII ? encodeURIComponent(config.directory) : config.directory
    // The daemon currently uses x-opencode-directory; keep legacy headers for compatibility.
    defaultHeaders["x-opencode-directory"] = encodedDirectory
    defaultHeaders["x-zee-directory"] = encodedDirectory
    defaultHeaders["x-agent-core-directory"] = encodedDirectory
  }

  const customFetch = config?.fetch ?? fetch

  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await customFetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options?.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`Zee API error: ${response.status} ${response.statusText}`)
    }

    return (await response.json()) as T
  }

  return {
    baseUrl,

    // Session management
    sessions: {
      list: () => request<Session[]>("/session"),
      get: (id: string) => request<Session>(`/session/${id}`),
      create: (data: CreateSessionRequest) =>
        request<Session>("/session", { method: "POST", body: JSON.stringify(data) }),
      delete: (id: string) =>
        request<void>(`/session/${id}`, { method: "DELETE" }),
    },

    // Message handling
    messages: {
      send: (sessionId: string, content: string, agent?: string) =>
        request<Message>(`/session/${sessionId}/message`, {
          method: "POST",
          body: JSON.stringify({ content, agent }),
        }),
    },

    // Provider management
    providers: {
      list: () => request<Provider[]>("/provider"),
    },

    // Model management
    models: {
      list: () => request<Model[]>("/model"),
    },

    // Configuration
    config: {
      get: () => request<Config>("/config"),
      update: (data: Partial<Config>) =>
        request<Config>("/config", { method: "PATCH", body: JSON.stringify(data) }),
    },

    // Raw request for custom endpoints
    request,
  }
}

/** @deprecated Use createZeeClient instead */
export const createAgentCoreClient = createZeeClient

/** @deprecated Use createZeeClient instead */
export const createOpencodeClient = createZeeClient

// Type definitions
export interface Session {
  id: string
  title?: string
  createdAt: number
  updatedAt: number
  agent?: string
}

export interface CreateSessionRequest {
  title?: string
  agent?: string
  model?: string
}

export interface Message {
  id: string
  sessionId: string
  role: "user" | "assistant"
  content: string
  createdAt: number
}

export interface Provider {
  id: string
  name: string
  models: string[]
}

export interface Model {
  id: string
  providerId: string
  name: string
}

export interface Config {
  theme?: string
  model?: string
  provider?: string
  [key: string]: unknown
}

// Re-export types for convenience
export type { ClientConfig as ZeeClientConfig }
/** @deprecated Use ZeeClientConfig instead */
export type { ClientConfig as AgentCoreClientConfig }
