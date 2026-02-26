import { Flag } from "@/flag/flag"
import { RequestMeta } from "./request-meta"

type AcquireOk = {
  ok: true
  release: () => void
  clientKey: string
  maxTotal: number
  maxPerClient: number
}

type AcquireError = {
  ok: false
  status: 429
  error: string
  clientKey: string
  maxTotal: number
  maxPerClient: number
}

type AcquireResult = AcquireOk | AcquireError

const DEFAULT_MAX_TOTAL = 64
const DEFAULT_MAX_PER_CLIENT = 8

let activeTotal = 0
const activeByClient = new Map<string, number>()

function isLoopbackIp(value: string): boolean {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1"
}

function normalizeIp(value: string): string {
  return value.trim().replace(/^\[|\]$/g, "")
}

function stripPort(value: string): string {
  const normalized = normalizeIp(value)
  // IPv6 literals usually include ":"; if wrapped in [] we already stripped them.
  // Keep IPv6 as-is and strip port only for likely IPv4 host:port shapes.
  if (normalized.includes(":") && !normalized.includes(".")) return normalized
  return normalized.replace(/:\d+$/, "")
}

function parseTrustedProxyIps(raw?: string): Set<string> {
  const set = new Set<string>()
  if (!raw) return set
  for (const entry of raw.split(",")) {
    const candidate = stripPort(entry)
    if (candidate) set.add(candidate)
  }
  return set
}

function resolveForwardedClientIp(req: Request): string | undefined {
  if (!Flag.ZEE_SERVER_TRUST_X_FORWARDED_FOR) return undefined

  const remoteIp = RequestMeta.getIp(req)
  if (!remoteIp) return undefined

  const normalizedRemote = stripPort(remoteIp)
  const trustedProxyIps = parseTrustedProxyIps(Flag.ZEE_SERVER_TRUSTED_PROXIES)
  const trustedPeer = isLoopbackIp(normalizedRemote) || trustedProxyIps.has(normalizedRemote)
  if (!trustedPeer) return undefined

  const forwarded = req.headers.get("x-forwarded-for")
  if (!forwarded) return undefined

  const firstHop = forwarded.split(",")[0]?.trim()
  if (!firstHop) return undefined

  const clientIp = stripPort(firstHop)
  if (!clientIp) return undefined
  return clientIp
}

function resolveLimits(): { maxTotal: number; maxPerClient: number } {
  const maxTotal = Flag.ZEE_SERVER_MAX_SSE_CONNECTIONS ?? DEFAULT_MAX_TOTAL
  const maxPerClient = Flag.ZEE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT ?? DEFAULT_MAX_PER_CLIENT
  return { maxTotal, maxPerClient }
}

function resolveClientKey(req: Request): string {
  const forwardedIp = resolveForwardedClientIp(req)
  if (forwardedIp) return forwardedIp

  const ip = RequestMeta.getIp(req)
  if (ip) return stripPort(ip)

  return "unknown"
}

export namespace SseLimit {
  export function resetForTests() {
    activeTotal = 0
    activeByClient.clear()
  }

  export function stats() {
    const { maxTotal, maxPerClient } = resolveLimits()
    return {
      activeTotal,
      activeClients: activeByClient.size,
      maxTotal,
      maxPerClient,
    }
  }

  export function acquire(req: Request): AcquireResult {
    const { maxTotal, maxPerClient } = resolveLimits()
    const clientKey = resolveClientKey(req)

    if (activeTotal >= maxTotal) {
      return {
        ok: false,
        status: 429,
        error: "Too many concurrent SSE connections (server limit exceeded).",
        clientKey,
        maxTotal,
        maxPerClient,
      }
    }

    const current = activeByClient.get(clientKey) ?? 0
    if (current >= maxPerClient) {
      return {
        ok: false,
        status: 429,
        error: "Too many concurrent SSE connections from this client.",
        clientKey,
        maxTotal,
        maxPerClient,
      }
    }

    activeTotal += 1
    activeByClient.set(clientKey, current + 1)

    let released = false
    const release = () => {
      if (released) return
      released = true

      activeTotal = Math.max(0, activeTotal - 1)
      const next = (activeByClient.get(clientKey) ?? 1) - 1
      if (next <= 0) activeByClient.delete(clientKey)
      else activeByClient.set(clientKey, next)
    }

    return { ok: true, release, clientKey, maxTotal, maxPerClient }
  }
}
