import { randomUUID } from "node:crypto"
import { createConnection, type Socket } from "node:net"

export type RuntimeAgent = "zee"

export type OrchestrationCommand = "run_task" | "list_events"

interface OrchestrationRequest<T = unknown> {
  id: string
  command: OrchestrationCommand
  params?: T
  timestamp: number
}

interface OrchestrationResponse<T = unknown> {
  id: string
  success: boolean
  data?: T
  error?: string
  timestamp: number
}

export interface RunTaskParams {
  agent?: RuntimeAgent
  description?: string
  prompt: string
  parentSessionId?: string
  parentMessageId?: string
  timeoutMs?: number
  waitTimeoutMs?: number
  priority?: number
  taskId?: string
}

export interface TaskInfo {
  id: string
  description: string
  agent: RuntimeAgent
  status: "pending" | "running" | "completed" | "failed" | "aborted"
  priority: number
  attempt: number
  error?: string
  workerId?: string
  createdAt: string
  enqueuedAt: string
  startedAt?: string
  endedAt?: string
}

export interface TaskRunResult {
  task: TaskInfo
  output: string
}

export interface OrchestrationEvent {
  id: number
  type:
    | "agent_start"
    | "turn_start"
    | "message_start"
    | "tool_execution_update"
    | "turn_end"
    | "agent_end"
    | "retry"
    | "interrupt"
    | "queue_overflow"
    | "worker_heartbeat"
  timestamp: number
  runId?: string
  sessionId?: string
  taskId?: string
  workerId?: string
  details?: Record<string, unknown>
}

export interface ListEventsParams {
  cursor?: number
  limit?: number
}

export interface ListEventsResult {
  events: OrchestrationEvent[]
  nextCursor: number
}

export interface OrchestrationClientOptions {
  socketPath?: string
  timeoutMs?: number
}

export function defaultSocketPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp"
  const stateHome = process.env.XDG_STATE_HOME || `${home}/.local/state`
  return `${stateHome}/zee/daemon/daemon.sock`
}

export async function requestOrchestration<TParams = unknown, TResult = unknown>(
  command: OrchestrationCommand,
  params?: TParams,
  options: OrchestrationClientOptions = {},
): Promise<TResult> {
  const configuredSocketPath = options.socketPath || process.env.ZEE_IPC_SOCKET
  const socketPath = configuredSocketPath || defaultSocketPath()
  const timeoutMs = options.timeoutMs ?? 30_000

  const request: OrchestrationRequest<TParams> = {
    id: randomUUID(),
    command,
    params,
    timestamp: Date.now(),
  }

  const formatSocketError = (error: unknown, targetPath: string): Error => {
    const err = error as NodeJS.ErrnoException
    const code = err.code
    const message = (err instanceof Error ? err.message : String(error)).toLowerCase()
    if (code === "ENOENT" || message.includes("enoent")) {
      return new Error(`orchestration daemon not running (socket missing: ${targetPath})`)
    }
    if (
      code === "ECONNREFUSED" ||
      code === "ENXIO" ||
      message.includes("econnrefused") ||
      message.includes("enxio") ||
      message.includes("no such device or address")
    ) {
      return new Error(`orchestration daemon refused connection: ${targetPath}`)
    }
    return err instanceof Error ? err : new Error(String(error))
  }

  const requestViaSocket = (targetPath: string) =>
    new Promise<TResult>((resolve, reject) => {
      let socket: Socket | null = null
      let settled = false
      let buffer = ""

      const cleanup = () => {
        if (!socket) return
        socket.removeAllListeners()
        socket.destroy()
        socket = null
      }

      const settle = (cb: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        cb()
      }

      const timer = setTimeout(() => {
        settle(() => reject(new Error(`orchestration request timed out after ${timeoutMs}ms`)))
      }, timeoutMs)

      try {
        socket = createConnection(targetPath)
        socket.on("connect", () => {
          socket!.write(JSON.stringify(request) + "\n")
        })

        socket.on("data", (chunk) => {
          buffer += chunk.toString()
          const newlineIdx = buffer.indexOf("\n")
          if (newlineIdx < 0) return
          const payload = buffer.slice(0, newlineIdx)
          clearTimeout(timer)

          try {
            const response = JSON.parse(payload) as OrchestrationResponse<TResult>
            if (response.id !== request.id) {
              settle(() => reject(new Error(`response id mismatch: expected ${request.id}, got ${response.id}`)))
              return
            }
            if (!response.success) {
              settle(() => reject(new Error(response.error || "orchestration daemon error")))
              return
            }
            settle(() => resolve(response.data as TResult))
          } catch (error) {
            settle(() => reject(new Error(`failed to parse orchestration response: ${payload}`)))
          }
        })

        socket.on("error", (error) => {
          clearTimeout(timer)
          settle(() => reject(formatSocketError(error, targetPath)))
        })

        socket.on("close", () => {
          clearTimeout(timer)
          settle(() => reject(new Error("orchestration daemon connection closed before response")))
        })
      } catch (error) {
        clearTimeout(timer)
        settle(() => reject(formatSocketError(error, targetPath)))
      }
    })

  return await requestViaSocket(socketPath)
}

export async function runTaskViaDaemon(
  params: RunTaskParams,
  options?: OrchestrationClientOptions,
): Promise<TaskRunResult> {
  return requestOrchestration<RunTaskParams, TaskRunResult>("run_task", params, options)
}

export async function listDaemonEvents(
  params: ListEventsParams = {},
  options?: OrchestrationClientOptions,
): Promise<ListEventsResult> {
  return requestOrchestration<ListEventsParams, ListEventsResult>("list_events", params, options)
}
