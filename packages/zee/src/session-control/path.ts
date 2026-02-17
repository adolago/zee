import path from "node:path"
import { Global } from "@/global"

export const SESSION_CONTROL_SOCKET_SUFFIX = ".sock"
export const SESSION_CONTROL_ALIAS_SUFFIX = ".alias"

export function getSessionControlDir(): string {
  return path.join(Global.Path.state, "session-control")
}

export function getSessionControlSocket(sessionID: string): string {
  return path.join(getSessionControlDir(), `${sessionID}${SESSION_CONTROL_SOCKET_SUFFIX}`)
}

export function getSessionControlAliasPath(alias: string): string {
  return path.join(getSessionControlDir(), `${alias}${SESSION_CONTROL_ALIAS_SUFFIX}`)
}

export function isSafeSessionID(sessionID: string): boolean {
  const trimmed = sessionID.trim()
  return trimmed.length > 0 && !trimmed.includes("/") && !trimmed.includes("\\") && !trimmed.includes("..")
}

export function isSafeAlias(alias: string): boolean {
  const trimmed = alias.trim()
  return /^[a-z0-9._-]+$/i.test(trimmed)
}

export function normalizeAlias(value?: string): string | null {
  if (!value) return null
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
  if (!normalized || !isSafeAlias(normalized)) return null
  return normalized
}

export function sessionIDFromSocketName(name: string): string | null {
  if (!name.endsWith(SESSION_CONTROL_SOCKET_SUFFIX)) return null
  const sessionID = name.slice(0, -SESSION_CONTROL_SOCKET_SUFFIX.length)
  if (!isSafeSessionID(sessionID)) return null
  return sessionID
}
