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

function resolveLimits(): { maxTotal: number; maxPerClient: number } {
  const maxTotal = Flag.AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS ?? DEFAULT_MAX_TOTAL
  const maxPerClient = Flag.AGENT_CORE_SERVER_MAX_SSE_CONNECTIONS_PER_CLIENT ?? DEFAULT_MAX_PER_CLIENT
  return { maxTotal, maxPerClient }
}

function resolveClientKey(req: Request): string {
  const ip = RequestMeta.getIp(req)
  if (ip) return ip

  // Best-effort fallback when the server isn't providing request IP metadata.
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (forwarded) return forwarded

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
