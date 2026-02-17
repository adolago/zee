import fs from "node:fs/promises"
import type { Dirent } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import path from "node:path"
import type { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { SessionSteering } from "@/session/steering"
import { MessageV2 } from "@/session/message-v2"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import {
  getSessionControlAliasPath,
  getSessionControlDir,
  getSessionControlSocket,
  isSafeAlias,
  isSafeSessionID,
  normalizeAlias,
  sessionIDFromSocketName,
} from "./path"
import { SessionControlTypes } from "./types"
import { listLiveSessions } from "./discovery"

const log = Log.create({ service: "session-control:server" })

type ServerHandle = {
  server: Server
  socketPath: string
  aliases: string[]
}

const handles = new Map<string, ServerHandle>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT") throw error
  }
}

async function removeAliasesForSocket(socketPath: string): Promise<void> {
  const controlDir = getSessionControlDir()

  let entries: Dirent[] = []
  try {
    entries = await fs.readdir(controlDir, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return
    throw error
  }

  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue
    const aliasPath = path.join(controlDir, entry.name)
    let target: string
    try {
      target = await fs.readlink(aliasPath)
    } catch {
      continue
    }

    const resolvedTarget = path.resolve(controlDir, target)
    if (resolvedTarget !== socketPath) continue
    await unlinkIfExists(aliasPath)
  }
}

async function createAliasSymlink(sessionID: string, alias: string): Promise<boolean> {
  if (!isSafeAlias(alias)) return false
  const aliasPath = getSessionControlAliasPath(alias)
  const target = `${sessionID}.sock`
  const controlDir = getSessionControlDir()

  try {
    const currentTarget = await fs.readlink(aliasPath)
    const currentResolved = path.resolve(controlDir, currentTarget)
    const currentSessionID = sessionIDFromSocketName(path.basename(currentResolved))
    if (currentSessionID && currentSessionID !== sessionID) {
      return false
    }
  } catch {
    // alias does not exist yet
  }

  await unlinkIfExists(aliasPath)
  await fs.symlink(target, aliasPath)
  return true
}

function response(input: {
  command: string
  success: boolean
  data?: unknown
  error?: string
  id?: string
}): SessionControlTypes.Response {
  return {
    type: "response",
    command: input.command,
    success: input.success,
    data: input.data,
    error: input.error,
    id: input.id,
  }
}

function writeResponse(socket: Socket, payload: SessionControlTypes.Response): void {
  try {
    socket.write(`${JSON.stringify(payload)}\n`)
  } catch {
    // ignore closed socket
  }
}

async function getLastAssistantMessage(sessionID: string): Promise<SessionControlTypes.LastAssistantMessage | null> {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role !== "assistant") continue
    const text = item.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()
    if (!text) continue
    return {
      id: item.info.id,
      text,
      createdAt: item.info.time.created,
      completedAt: item.info.time.completed,
    }
  }
  return null
}

async function handleGetSummary(sessionID: string) {
  const { SessionSummary } = await import("@/session/summary")
  const summary = await SessionSummary.handoffSummary(sessionID)
  return { summary }
}

async function waitForIdle(sessionID: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = SessionStatus.get(sessionID)
    if (status.type !== "busy") return
    await sleep(50)
  }
  throw new Error(`Timed out waiting for session ${sessionID} to become idle`)
}

async function handleClear(sessionID: string) {
  const { Session } = await import("@/session")
  const { Storage } = await import("@/storage/storage")
  const { SessionPrompt } = await import("@/session/prompt")

  if (SessionStatus.get(sessionID).type === "busy") {
    SessionPrompt.cancel(sessionID)
    await waitForIdle(sessionID, 10_000)
  }

  const messages = await Session.messages({ sessionID })
  const removedMessages = messages.length
  const removedParts = messages.reduce((sum, msg) => sum + msg.parts.length, 0)

  for (const msg of messages) {
    for (const part of msg.parts) {
      await Session.removePart({
        sessionID,
        messageID: msg.info.id,
        partID: part.id,
      })
    }
    await Session.removeMessage({ sessionID, messageID: msg.info.id })
  }

  await Session.update(sessionID, (draft) => {
    draft.revert = undefined
    draft.summary = undefined
  })
  await Storage.remove(["session_diff", sessionID])
  SessionSteering.clear(sessionID)
  SessionStatus.set(sessionID, { type: "idle" })

  return {
    cleared: true,
    removedMessages,
    removedParts,
  }
}

async function handleAbort(sessionID: string) {
  const { SessionPrompt } = await import("@/session/prompt")
  const wasBusy = SessionStatus.get(sessionID).type === "busy"
  SessionPrompt.cancel(sessionID)
  return {
    aborted: true,
    wasBusy,
    status: SessionStatus.get(sessionID),
  }
}

async function handleSend(sessionID: string, command: SessionControlTypes.Command & { type: "send" }) {
  const { SessionPrompt } = await import("@/session/prompt")

  const mode = command.mode ?? "steer"
  const status = SessionStatus.get(sessionID)
  const activeTurnID = status.type === "busy" ? status.activeTurnID : undefined

  if (!activeTurnID) {
    throw new Error(`No active turn to receive ${mode} message.`)
  }

  if (mode === "steer" && command.expectedTurnID && activeTurnID !== command.expectedTurnID) {
    const err = new Error("Steer rejected: expectedTurnID does not match active turn.") as Error & {
      data?: Record<string, string>
    }
    err.data = { activeTurnID }
    throw err
  }

  const senderInfo = command.senderInfo ? `\n\n<sender_info>${JSON.stringify(command.senderInfo)}</sender_info>` : ""

  await SessionPrompt.prompt({
    sessionID,
    parts: [{ type: "text", text: `${command.message}${senderInfo}` }],
    noReply: true,
  })

  if (mode === "steer") {
    SessionSteering.mark(sessionID, activeTurnID)
  }

  return {
    delivered: true,
    mode,
    activeTurnID,
  }
}

async function handleCommand(
  sessionID: string,
  command: SessionControlTypes.Command,
): Promise<SessionControlTypes.Response> {
  try {
    switch (command.type) {
      case "ping":
        return response({ command: "ping", success: true, data: { sessionID }, id: command.id })
      case "status": {
        const status = SessionStatus.get(sessionID)
        return response({
          command: "status",
          success: true,
          data: {
            sessionID,
            status,
          },
          id: command.id,
        })
      }
      case "get_message": {
        const message = await getLastAssistantMessage(sessionID)
        return response({ command: "get_message", success: true, data: { message }, id: command.id })
      }
      case "get_summary": {
        const result = await handleGetSummary(sessionID)
        return response({ command: "get_summary", success: true, data: result, id: command.id })
      }
      case "clear": {
        const result = await handleClear(sessionID)
        return response({ command: "clear", success: true, data: result, id: command.id })
      }
      case "abort": {
        const result = await handleAbort(sessionID)
        return response({ command: "abort", success: true, data: result, id: command.id })
      }
      case "list_sessions": {
        const sessions = await listLiveSessions()
        return response({ command: "list_sessions", success: true, data: { sessions }, id: command.id })
      }
      case "send": {
        const result = await handleSend(sessionID, command)
        return response({ command: "send", success: true, data: result, id: command.id })
      }
    }
  } catch (error) {
    const err = error as Error & { data?: unknown }
    return response({
      command: command.type,
      success: false,
      error: err.message,
      data: err.data,
      id: command.id,
    })
  }
}

function registerConnectionHandler(server: Server, sessionID: string): void {
  server.on("connection", (socket) => {
    socket.setEncoding("utf8")
    let buffer = ""

    socket.on("data", (chunk) => {
      buffer += chunk
      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf("\n")

        if (!line) continue

        let parsed: SessionControlTypes.Command
        try {
          parsed = SessionControlTypes.Command.parse(JSON.parse(line))
        } catch {
          writeResponse(
            socket,
            response({
              command: "invalid",
              success: false,
              error: "Invalid command payload",
            }),
          )
          continue
        }

        void handleCommand(sessionID, parsed).then((res) => writeResponse(socket, res))
      }
    })
  })
}

async function resolveAliases(session: Session.Info): Promise<string[]> {
  const aliases = [] as string[]

  const add = async (raw?: string) => {
    const alias = normalizeAlias(raw)
    if (!alias) return
    if (alias === session.id) return
    if (aliases.includes(alias)) return
    if (!(await createAliasSymlink(session.id, alias))) return
    aliases.push(alias)
  }

  await add(session.slug)
  await add(session.title)
  return aliases
}

async function startServer(session: Session.Info): Promise<ServerHandle> {
  if (!isSafeSessionID(session.id)) {
    throw new Error(`Unsafe session id for session-control: ${session.id}`)
  }

  const controlDir = getSessionControlDir()
  await fs.mkdir(controlDir, { recursive: true })

  const socketPath = getSessionControlSocket(session.id)
  await unlinkIfExists(socketPath)

  const server = createServer()
  registerConnectionHandler(server, session.id)

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, () => {
      server.removeListener("error", reject)
      resolve()
    })
  })

  const aliases = await resolveAliases(session)
  return { server, socketPath, aliases }
}

export namespace SessionControlServer {
  export function enabled() {
    return Flag.ZEE_SESSION_CONTROL === true
  }

  export async function start(session: Session.Info): Promise<boolean> {
    if (!enabled()) return false
    if (handles.has(session.id)) return true

    try {
      const handle = await startServer(session)
      handles.set(session.id, handle)
      process.env.ZEE_SESSION_ID = session.id
      log.info("session-control started", {
        sessionID: session.id,
        socketPath: handle.socketPath,
        aliases: handle.aliases,
      })
      return true
    } catch (error) {
      log.warn("failed to start session-control", {
        sessionID: session.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  export async function stop(sessionID: string): Promise<void> {
    const handle = handles.get(sessionID)
    if (!handle) return

    handles.delete(sessionID)
    await new Promise<void>((resolve) => {
      handle.server.close(() => resolve())
    })

    await unlinkIfExists(handle.socketPath)
    await removeAliasesForSocket(handle.socketPath)

    if (process.env.ZEE_SESSION_ID === sessionID) {
      delete process.env.ZEE_SESSION_ID
    }

    log.info("session-control stopped", { sessionID, socketPath: handle.socketPath })
  }

  export async function stopAll(): Promise<void> {
    await Promise.all(Array.from(handles.keys()).map((sessionID) => stop(sessionID)))
  }
}
