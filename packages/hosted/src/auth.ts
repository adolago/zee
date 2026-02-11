import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "crypto"
import type { Context, Next } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import { db } from "./db"
import { env } from "./env"

export const SESSION_COOKIE = "zee_hosted_session"
const SESSION_TTL_MS = env.SESSION_TTL_HOURS * 60 * 60 * 1000

export type UserRecord = {
  id: string
  email: string
}

export function hashPassword(password: string) {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, 64)
  return `${salt.toString("base64")}:${derived.toString("base64")}`
}

export function verifyPassword(password: string, stored: string) {
  const [saltB64, hashB64] = stored.split(":")
  if (!saltB64 || !hashB64) return false
  const salt = Buffer.from(saltB64, "base64")
  const expected = Buffer.from(hashB64, "base64")
  const derived = scryptSync(password, salt, expected.length)
  return timingSafeEqual(expected, derived)
}

export function createSession(userId: string) {
  const id = randomUUID()
  const now = Date.now()
  const expiresAt = now + SESSION_TTL_MS
  db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userId, now, expiresAt, now)
  return id
}

export function destroySession(id: string) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id)
}

export function getSession(id: string) {
  return db
    .prepare("SELECT id, user_id, created_at, expires_at, last_seen_at FROM sessions WHERE id = ?")
    .get(id) as
    | { id: string; user_id: string; created_at: number; expires_at: number; last_seen_at: number }
    | undefined
}

export function getUserByEmail(email: string) {
  return db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email) as
    | { id: string; email: string; password_hash: string }
    | undefined
}

export function getUserById(id: string) {
  return db.prepare("SELECT id, email FROM users WHERE id = ?").get(id) as UserRecord | undefined
}

export function getUserFromSession(sessionId: string | undefined) {
  if (!sessionId) return undefined
  const session = getSession(sessionId)
  if (!session) return undefined
  if (session.expires_at < Date.now()) {
    destroySession(sessionId)
    return undefined
  }
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(Date.now(), sessionId)
  return getUserById(session.user_id)
}

export function setSessionCookie(c: Context, sessionId: string) {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: false,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    sameSite: "Lax",
  })
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" })
}

export async function requireApiAuth(c: Context, next: Next) {
  const sessionId = getCookie(c, SESSION_COOKIE)
  const user = getUserFromSession(sessionId)
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  c.set("user", user)
  await next()
}
