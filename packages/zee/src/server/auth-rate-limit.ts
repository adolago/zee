export type AuthRateLimitConfig = {
  maxAttempts?: number
  windowMs?: number
  lockoutMs?: number
  exemptLoopback?: boolean
}

export type AuthRateLimitCheckResult = {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

export type AuthRateLimiter = {
  check(ip: string | undefined): AuthRateLimitCheckResult
  recordFailure(ip: string | undefined): void
  reset(ip: string | undefined): void
  prune(): void
  size(): number
  dispose(): void
}

type RateLimitEntry = {
  attempts: number[]
  lockedUntil?: number
}

const DEFAULT_MAX_ATTEMPTS = 10
const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_LOCKOUT_MS = 300_000
const PRUNE_INTERVAL_MS = 60_000

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "1" || normalized === "true") return true
  if (normalized === "0" || normalized === "false") return false
  return undefined
}

export function resolveAuthRateLimitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthRateLimitConfig | undefined {
  const enabled = parseBool(env.ZEE_SERVER_AUTH_RATE_LIMIT)
  if (!enabled) return undefined

  return {
    maxAttempts: parsePositiveInt(env.ZEE_SERVER_AUTH_RATE_LIMIT_MAX_ATTEMPTS),
    windowMs: parsePositiveInt(env.ZEE_SERVER_AUTH_RATE_LIMIT_WINDOW_MS),
    lockoutMs: parsePositiveInt(env.ZEE_SERVER_AUTH_RATE_LIMIT_LOCKOUT_MS),
    exemptLoopback: parseBool(env.ZEE_SERVER_AUTH_RATE_LIMIT_EXEMPT_LOOPBACK),
  }
}

export function createAuthRateLimiter(config?: AuthRateLimitConfig): AuthRateLimiter {
  const maxAttempts = config?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS
  const lockoutMs = config?.lockoutMs ?? DEFAULT_LOCKOUT_MS
  const exemptLoopback = config?.exemptLoopback ?? true
  const entries = new Map<string, RateLimitEntry>()

  const timer = setInterval(() => prune(), PRUNE_INTERVAL_MS)
  timer.unref?.()

  function normalizeIp(ip: string | undefined): string {
    const value = ip?.trim()
    return value && value.length > 0 ? value : "unknown"
  }

  function isLoopbackIp(ip: string): boolean {
    const value = ip.trim().toLowerCase()
    return value === "127.0.0.1" || value === "::1" || value === "localhost" || value === "::ffff:127.0.0.1"
  }

  function slideWindow(entry: RateLimitEntry, now: number): void {
    const cutoff = now - windowMs
    entry.attempts = entry.attempts.filter((ts) => ts > cutoff)
  }

  function check(ip: string | undefined): AuthRateLimitCheckResult {
    const normalizedIp = normalizeIp(ip)
    if (exemptLoopback && isLoopbackIp(normalizedIp)) {
      return { allowed: true, remaining: maxAttempts, retryAfterMs: 0 }
    }

    const now = Date.now()
    const entry = entries.get(normalizedIp)
    if (!entry) {
      return { allowed: true, remaining: maxAttempts, retryAfterMs: 0 }
    }

    if (entry.lockedUntil && now < entry.lockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: entry.lockedUntil - now,
      }
    }

    if (entry.lockedUntil && now >= entry.lockedUntil) {
      entry.lockedUntil = undefined
      entry.attempts = []
    }

    slideWindow(entry, now)
    const remaining = Math.max(0, maxAttempts - entry.attempts.length)
    return { allowed: remaining > 0, remaining, retryAfterMs: 0 }
  }

  function recordFailure(ip: string | undefined): void {
    const normalizedIp = normalizeIp(ip)
    if (exemptLoopback && isLoopbackIp(normalizedIp)) return

    const now = Date.now()
    let entry = entries.get(normalizedIp)
    if (!entry) {
      entry = { attempts: [] }
      entries.set(normalizedIp, entry)
    }

    if (entry.lockedUntil && now < entry.lockedUntil) {
      return
    }

    slideWindow(entry, now)
    entry.attempts.push(now)

    if (entry.attempts.length >= maxAttempts) {
      entry.lockedUntil = now + lockoutMs
    }
  }

  function reset(ip: string | undefined): void {
    const normalizedIp = normalizeIp(ip)
    entries.delete(normalizedIp)
  }

  function prune(): void {
    const now = Date.now()
    for (const [ip, entry] of entries.entries()) {
      if (entry.lockedUntil && now < entry.lockedUntil) continue
      slideWindow(entry, now)
      if (entry.attempts.length === 0) entries.delete(ip)
    }
  }

  function size(): number {
    return entries.size
  }

  function dispose(): void {
    clearInterval(timer)
    entries.clear()
  }

  return { check, recordFailure, reset, prune, size, dispose }
}
