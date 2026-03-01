import { Log } from "@/util/log"
import { FluxStore } from "./store"
import { redactValue } from "./redact"
import type { FluxEvent, FluxQuery, FluxRedaction, FluxSessionPath, FluxStoreConfig } from "./types"

const log = Log.create({ service: "flux" })

const DEFAULT_RETENTION_HOURS = 24
const DEFAULT_MAX_EVENTS = 20_000
const DEFAULT_MAX_EVENTS_PER_TRACE = 1_000

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true
  if (normalized === "0" || normalized === "false" || normalized === "no") return false
  return fallback
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseRedaction(value: string | undefined): FluxRedaction {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "balanced") return "balanced"
  if (normalized === "debug") return "debug"
  return "strict"
}

function resolveInitialConfig(): FluxStoreConfig {
  const retentionHours = parseNumber(process.env.ZEE_FLUX_RETENTION_HOURS, DEFAULT_RETENTION_HOURS)
  return {
    enabled: parseBoolean(process.env.ZEE_FLUX_ENABLED, true),
    retentionMs: retentionHours * 60 * 60 * 1000,
    maxEvents: parseNumber(process.env.ZEE_FLUX_MAX_EVENTS, DEFAULT_MAX_EVENTS),
    maxEventsPerTrace: parseNumber(process.env.ZEE_FLUX_MAX_EVENTS_PER_TRACE, DEFAULT_MAX_EVENTS_PER_TRACE),
    redaction: parseRedaction(process.env.ZEE_FLUX_REDACTION),
    logMirror: parseBoolean(process.env.ZEE_FLUX_LOG_MIRROR, true),
  }
}

const store = new FluxStore(resolveInitialConfig())

type RecordInput = Omit<FluxEvent, "id" | "timestamp">

export namespace FluxRecorder {
  export function configure(partial: Partial<FluxStoreConfig>) {
    const current = store.getConfig()
    store.setConfig({
      ...current,
      ...partial,
    })
  }

  export function config(): FluxStoreConfig {
    return store.getConfig()
  }

  export function record(input: RecordInput): FluxEvent {
    const cfg = store.getConfig()
    const event: FluxEvent = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...input,
      metadata: redactValue(input.metadata ?? {}, cfg.redaction) as Record<string, unknown>,
    }
    store.add(event)
    if (cfg.logMirror) {
      const latencyMs = event.latencyMs
      log.info("flux event", {
        traceID: event.traceID,
        sessionID: event.sessionID,
        requestID: event.requestID,
        domain: event.domain,
        kind: event.kind,
        status: event.status,
        route: event.route,
        method: event.method,
        statusCode: event.statusCode,
        latencyMs,
      })
    }
    return event
  }

  export function list(query: FluxQuery = {}) {
    return {
      events: store.list(query),
      total: store.count(query),
      limit: Math.max(1, Math.min(1000, query.limit ?? 200)),
      offset: Math.max(0, query.offset ?? 0),
      stats: store.getStats(),
    }
  }

  export function trace(traceID: string): FluxEvent[] {
    return store.getTrace(traceID)
  }

  export function sessionPath(sessionID: string): FluxSessionPath {
    return store.getSessionPath(sessionID)
  }

  export function schema() {
    return {
      version: 1,
      defaultRetentionHours: DEFAULT_RETENTION_HOURS,
      redaction: store.getConfig().redaction,
      fields: [
        "id",
        "timestamp",
        "traceID",
        "requestID",
        "sessionID",
        "messageID",
        "providerID",
        "modelID",
        "direction",
        "domain",
        "kind",
        "status",
        "method",
        "path",
        "route",
        "host",
        "url",
        "statusCode",
        "latencyMs",
        "bytesIn",
        "bytesOut",
        "token",
        "error",
        "metadata",
      ],
      statuses: ["ok", "error", "denied", "timeout", "aborted"],
    }
  }
}
