import fs from "node:fs/promises"
import type { Dirent } from "node:fs"
import { createConnection, type Socket } from "node:net"
import path from "node:path"
import { Log } from "@/util/log"
import {
  getSessionControlAliasPath,
  getSessionControlDir,
  getSessionControlSocket,
  isSafeAlias,
  isSafeSessionID,
  SESSION_CONTROL_ALIAS_SUFFIX,
  SESSION_CONTROL_SOCKET_SUFFIX,
  sessionIDFromSocketName,
} from "./path"
import { SessionControlTypes } from "./types"

const log = Log.create({ service: "session-control:discovery" })

type ProbeResult = {
  sessionID?: string
  status?: SessionControlTypes.LiveSession["status"]
}

function writeProbe(socket: Socket, payload: string): void {
  try {
    socket.write(payload)
  } catch {
    socket.destroy()
  }
}

async function probeSocket(socketPath: string, timeoutMs = 400): Promise<ProbeResult | null> {
  return await new Promise((resolve) => {
    const socket = createConnection(socketPath)
    let settled = false
    let buffer = ""

    const settle = (result: ProbeResult | null) => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    const timer = setTimeout(() => {
      settle(null)
    }, timeoutMs)

    socket.once("connect", () => {
      writeProbe(socket, `${JSON.stringify({ type: "status" })}\n`)
    })

    socket.on("data", (chunk) => {
      buffer += chunk.toString()
      const idx = buffer.indexOf("\n")
      if (idx < 0) return
      clearTimeout(timer)
      const line = buffer.slice(0, idx)
      try {
        const parsed = SessionControlTypes.Response.parse(JSON.parse(line))
        if (!parsed.success) {
          settle(null)
          return
        }

        const data = parsed.data as
          | { sessionID?: string; status?: SessionControlTypes.LiveSession["status"] }
          | undefined
        if (!data?.sessionID || !isSafeSessionID(data.sessionID)) {
          settle(null)
          return
        }
        settle({ sessionID: data.sessionID, status: data.status })
      } catch {
        settle(null)
      }
    })

    socket.once("error", () => {
      clearTimeout(timer)
      settle(null)
    })

    socket.once("close", () => {
      clearTimeout(timer)
      settle(null)
    })
  })
}

export async function resolveSessionIDFromAlias(alias: string): Promise<string | null> {
  if (!isSafeAlias(alias)) return null
  const aliasPath = getSessionControlAliasPath(alias)

  try {
    const target = await fs.readlink(aliasPath)
    const resolved = path.resolve(getSessionControlDir(), target)
    const sessionID = sessionIDFromSocketName(path.basename(resolved))
    return sessionID
  } catch {
    return null
  }
}

export async function resolveSocketPathFromAlias(alias: string): Promise<string | null> {
  const sessionID = await resolveSessionIDFromAlias(alias)
  if (!sessionID) return null
  return getSessionControlSocket(sessionID)
}

async function getAliasMap(): Promise<Map<string, string[]>> {
  const aliasMap = new Map<string, string[]>()
  const controlDir = getSessionControlDir()

  let entries: Dirent[] = []
  try {
    entries = await fs.readdir(controlDir, { withFileTypes: true })
  } catch {
    return aliasMap
  }

  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue
    if (!entry.name.endsWith(SESSION_CONTROL_ALIAS_SUFFIX)) continue

    const aliasPath = path.join(controlDir, entry.name)
    const alias = entry.name.slice(0, -SESSION_CONTROL_ALIAS_SUFFIX.length)
    if (!isSafeAlias(alias)) continue

    let target: string
    try {
      target = await fs.readlink(aliasPath)
    } catch {
      continue
    }

    const resolvedTarget = path.resolve(controlDir, target)
    const current = aliasMap.get(resolvedTarget)
    if (current) {
      current.push(alias)
      continue
    }
    aliasMap.set(resolvedTarget, [alias])
  }

  return aliasMap
}

export async function listLiveSessions(): Promise<SessionControlTypes.LiveSession[]> {
  const controlDir = getSessionControlDir()
  await fs.mkdir(controlDir, { recursive: true })

  const entries = await fs.readdir(controlDir, { withFileTypes: true })
  const aliasMap = await getAliasMap()
  const sessions: SessionControlTypes.LiveSession[] = []

  for (const entry of entries) {
    if (!entry.name.endsWith(SESSION_CONTROL_SOCKET_SUFFIX)) continue
    const socketPath = path.join(controlDir, entry.name)
    const sessionID = sessionIDFromSocketName(entry.name)
    if (!sessionID) continue

    const probe = await probeSocket(socketPath)
    if (!probe) continue

    const aliases = aliasMap.get(socketPath) ?? []
    sessions.push({
      sessionID,
      socketPath,
      aliases,
      name: aliases[0],
      status: probe.status,
    })
  }

  sessions.sort((a, b) => (a.name ?? a.sessionID).localeCompare(b.name ?? b.sessionID))
  log.debug("listed live sessions", { count: sessions.length })
  return sessions
}
