import { randomUUID } from "node:crypto"
import { createConnection, type Socket } from "node:net"
import { Log } from "@/util/log"
import { getSessionControlSocket, isSafeSessionID, normalizeAlias } from "./path"
import { SessionControlTypes } from "./types"
import { listLiveSessions, resolveSocketPathFromAlias } from "./discovery"

const log = Log.create({ service: "session-control:client" })

export class SessionControlError extends Error {
  constructor(
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = "SessionControlError"
  }
}

export interface RequestOptions {
  socketPath: string
  timeoutMs?: number
}

export interface TargetSessionOptions {
  sessionID?: string
  sessionName?: string
  timeoutMs?: number
}

export interface SendToSessionOptions extends TargetSessionOptions {
  message: string
  mode?: SessionControlTypes.SendMode
  expectedTurnID?: string
  senderInfo?: SessionControlTypes.SenderInfo
  waitUntil?: SessionControlTypes.WaitUntil
  waitTimeoutMs?: number
  pollIntervalMs?: number
}

export interface GetSummaryResult {
  summary: string
}

export interface ClearSessionResult {
  cleared: boolean
  removedMessages: number
  removedParts: number
}

export interface AbortSessionResult {
  aborted: boolean
  wasBusy?: boolean
  status?: SessionControlTypes.LiveSession["status"]
}

function formatSocketError(error: unknown, socketPath: string): Error {
  const err = error as NodeJS.ErrnoException
  const code = err.code
  const message = (err instanceof Error ? err.message : String(error)).toLowerCase()

  if (code === "ENOENT" || message.includes("enoent")) {
    return new Error(`session-control socket missing: ${socketPath}`)
  }
  if (code === "ECONNREFUSED" || message.includes("econnrefused") || message.includes("enxio")) {
    return new Error(`session-control socket refused connection: ${socketPath}`)
  }
  return err instanceof Error ? err : new Error(String(error))
}

export async function requestSessionControl<T = unknown>(
  command: SessionControlTypes.Command,
  options: RequestOptions,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000

  const payload = {
    ...command,
    id: command.id ?? randomUUID(),
  }

  return await new Promise<T>((resolve, reject) => {
    let socket: Socket | null = null
    let settled = false
    let buffer = ""

    const cleanup = () => {
      if (!socket) return
      socket.removeAllListeners()
      socket.destroy()
      socket = null
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`session-control request timed out after ${timeoutMs}ms`)))
    }, timeoutMs)

    try {
      socket = createConnection(options.socketPath)
      socket.once("connect", () => {
        socket!.write(`${JSON.stringify(payload)}\n`)
      })

      socket.on("data", (chunk) => {
        buffer += chunk.toString()
        const idx = buffer.indexOf("\n")
        if (idx < 0) return

        clearTimeout(timer)
        const line = buffer.slice(0, idx)
        try {
          const response = SessionControlTypes.Response.parse(JSON.parse(line))
          if (!response.success) {
            settle(() =>
              reject(new SessionControlError(response.error || "Session control command failed", response.data)),
            )
            return
          }
          settle(() => resolve(response.data as T))
        } catch {
          settle(() => reject(new Error(`invalid session-control response: ${line}`)))
        }
      })

      socket.once("error", (error) => {
        clearTimeout(timer)
        settle(() => reject(formatSocketError(error, options.socketPath)))
      })

      socket.once("close", () => {
        clearTimeout(timer)
        settle(() => reject(new Error("session-control connection closed before response")))
      })
    } catch (error) {
      clearTimeout(timer)
      settle(() => reject(formatSocketError(error, options.socketPath)))
    }
  })
}

async function resolveTargetSocketPath(input: TargetSessionOptions): Promise<string> {
  if (input.sessionID) {
    if (!isSafeSessionID(input.sessionID)) {
      throw new Error(`Unsafe session id: ${input.sessionID}`)
    }
    return getSessionControlSocket(input.sessionID)
  }
  if (input.sessionName) {
    const alias = normalizeAlias(input.sessionName)
    if (!alias) {
      throw new Error(`Invalid session alias: ${input.sessionName}`)
    }
    const fromAlias = await resolveSocketPathFromAlias(alias)
    if (!fromAlias) {
      throw new Error(`Unknown session alias: ${alias}`)
    }
    return fromAlias
  }
  throw new Error("Missing target session (sessionID or sessionName)")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getMessageBySocket(
  socketPath: string,
  timeoutMs?: number,
): Promise<SessionControlTypes.LastAssistantMessage | null> {
  const result = await requestSessionControl<{ message?: SessionControlTypes.LastAssistantMessage | null }>(
    { type: "get_message" },
    { socketPath, timeoutMs },
  )
  return result.message ?? null
}

async function getStatusBySocket(
  socketPath: string,
  timeoutMs?: number,
): Promise<SessionControlTypes.LiveSession["status"]> {
  const result = await requestSessionControl<{
    sessionID?: string
    status?: SessionControlTypes.LiveSession["status"]
  }>({ type: "status" }, { socketPath, timeoutMs })
  return result.status
}

async function waitForTurnEnd(input: {
  socketPath: string
  activeTurnID?: string
  timeoutMs: number
  pollIntervalMs: number
}): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < input.timeoutMs) {
    const status = await getStatusBySocket(input.socketPath, Math.min(5_000, input.timeoutMs))
    if (!status || status.type !== "busy") {
      return
    }
    if (input.activeTurnID && status.activeTurnID && status.activeTurnID !== input.activeTurnID) {
      return
    }
    await sleep(input.pollIntervalMs)
  }

  throw new Error(`Timed out waiting for turn_end after ${input.timeoutMs}ms`)
}

export async function getMessageFromSession(input: TargetSessionOptions): Promise<{
  message: SessionControlTypes.LastAssistantMessage | null
}> {
  const socketPath = await resolveTargetSocketPath(input)
  const message = await getMessageBySocket(socketPath, input.timeoutMs)
  return { message }
}

export async function getStatusFromSession(input: TargetSessionOptions): Promise<{
  status: SessionControlTypes.LiveSession["status"]
}> {
  const socketPath = await resolveTargetSocketPath(input)
  const status = await getStatusBySocket(socketPath, input.timeoutMs)
  return { status }
}

export async function getSummaryFromSession(input: TargetSessionOptions): Promise<GetSummaryResult> {
  const socketPath = await resolveTargetSocketPath(input)
  return requestSessionControl<GetSummaryResult>({ type: "get_summary" }, { socketPath, timeoutMs: input.timeoutMs })
}

export async function clearSession(input: TargetSessionOptions): Promise<ClearSessionResult> {
  const socketPath = await resolveTargetSocketPath(input)
  return requestSessionControl<ClearSessionResult>({ type: "clear" }, { socketPath, timeoutMs: input.timeoutMs })
}

export async function abortSession(input: TargetSessionOptions): Promise<AbortSessionResult> {
  const socketPath = await resolveTargetSocketPath(input)
  return requestSessionControl<AbortSessionResult>({ type: "abort" }, { socketPath, timeoutMs: input.timeoutMs })
}

export async function sendToSession(input: SendToSessionOptions): Promise<SessionControlTypes.SendResult> {
  const socketPath = await resolveTargetSocketPath(input)
  const result = await requestSessionControl<Omit<SessionControlTypes.SendResult, "waitUntil" | "message">>(
    {
      type: "send",
      message: input.message,
      mode: input.mode,
      expectedTurnID: input.expectedTurnID,
      senderInfo: input.senderInfo,
    },
    {
      socketPath,
      timeoutMs: input.timeoutMs,
    },
  )

  if (input.waitUntil === "turn_end") {
    await waitForTurnEnd({
      socketPath,
      activeTurnID: result.activeTurnID,
      timeoutMs: input.waitTimeoutMs ?? 300_000,
      pollIntervalMs: input.pollIntervalMs ?? 250,
    })

    const message = await getMessageBySocket(socketPath, input.timeoutMs)
    log.debug("sent message via session-control", {
      targetSessionID: input.sessionID,
      targetSessionName: input.sessionName,
      mode: input.mode,
      waitUntil: input.waitUntil,
    })
    return {
      ...result,
      waitUntil: "turn_end",
      message,
    }
  }

  if (input.waitUntil === "message_processed") {
    log.debug("sent message via session-control", {
      targetSessionID: input.sessionID,
      targetSessionName: input.sessionName,
      mode: input.mode,
      waitUntil: input.waitUntil,
    })
    return {
      ...result,
      waitUntil: "message_processed",
    }
  }

  log.debug("sent message via session-control", {
    targetSessionID: input.sessionID,
    targetSessionName: input.sessionName,
    mode: input.mode,
    waitUntil: input.waitUntil,
  })

  return result
}

export const SessionControlClient = {
  request: requestSessionControl,
  send: sendToSession,
  getMessage: getMessageFromSession,
  getSummary: getSummaryFromSession,
  clear: clearSession,
  abort: abortSession,
  getStatus: getStatusFromSession,
  list: listLiveSessions,
}
