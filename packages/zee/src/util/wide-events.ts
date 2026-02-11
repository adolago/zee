import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import fs from "fs/promises"
import path from "path"
import { Config } from "@/config/config"
import { Global } from "@/global"

export type WideEventPayloadPolicy = "summary" | "debug" | "full"

export type WideEventConfig = {
  enabled?: boolean
  file?: string
  sampleRate?: number
  slowMs?: number
  payloads?: WideEventPayloadPolicy
}

export type WideEvent = {
  ts: string
  service: string
  traceId: string
  requestId: string
  sessionId?: string
  messageId?: string
  parentId?: string
  agent?: string
  providerId?: string
  modelId?: string
  outcome?: "ok" | "error"
  durationMs?: number
  slow?: boolean
  debug?: boolean
  error?: { code?: string; message?: string }
  sample?: { kept: boolean; reason: string; rate?: number }
  request?: Record<string, unknown>
  meta?: Record<string, unknown>
}

type WideEventContext = {
  event: WideEvent
  startMs: number
  debug: boolean
  payloadPolicy: WideEventPayloadPolicy
  sampleRate: number
  slowMs: number
  file: string
  finished: boolean
}

const storage = new AsyncLocalStorage<WideEventContext>()
const writesByPath = new Map<string, Promise<void>>()
const DEFAULT_SAMPLE_RATE = 0.02
const DEFAULT_SLOW_MS = 2000

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12)
}

function resolveWideEventFile(): string {
  const today = new Date().toISOString().slice(0, 10)
  return path.join(Global.Path.log, `agent-core-wide-${today}.jsonl`)
}

async function resolveWideEventSettings(): Promise<{
  enabled: boolean
  file: string
  sampleRate: number
  slowMs: number
  payloads: WideEventPayloadPolicy
  debug: boolean
}> {
  const cfg = await Config.get()
  const wide = cfg.wideEvents
  const logLevel = cfg.logLevel ?? "INFO"
  const debug = logLevel === "DEBUG"
  return {
    enabled: wide?.enabled ?? true,
    file: wide?.file ?? resolveWideEventFile(),
    sampleRate: typeof wide?.sampleRate === "number" ? wide.sampleRate : DEFAULT_SAMPLE_RATE,
    slowMs: typeof wide?.slowMs === "number" ? wide.slowMs : DEFAULT_SLOW_MS,
    payloads: wide?.payloads ?? "debug",
    debug,
  }
}

export async function resolveWideEventLogPath(): Promise<string> {
  const settings = await resolveWideEventSettings()
  return settings.file
}

export async function runWithWideEventContext<T>(
  init: Omit<WideEvent, "ts"> & { ts?: string },
  fn: () => Promise<T>,
  opts?: { debug?: boolean; payloadPolicy?: WideEventPayloadPolicy },
): Promise<T> {
  const settings = await resolveWideEventSettings()
  if (!settings.enabled) return fn()

  const debug = opts?.debug ?? settings.debug
  const payloadPolicy = opts?.payloadPolicy ?? settings.payloads
  const ctx: WideEventContext = {
    event: {
      ts: init.ts ?? new Date().toISOString(),
      ...init,
      debug,
    },
    startMs: Date.now(),
    debug,
    payloadPolicy,
    sampleRate: settings.sampleRate,
    slowMs: settings.slowMs,
    file: settings.file,
    finished: false,
  }
  return storage.run(ctx, fn)
}

export function getWideEventContext(): WideEventContext | undefined {
  return storage.getStore()
}

export function addWideEventFields(fields: Partial<WideEvent>) {
  const ctx = storage.getStore()
  if (!ctx || ctx.finished) return
  ctx.event = {
    ...ctx.event,
    ...fields,
    request: {
      ...(ctx.event.request ?? {}),
      ...(fields.request ?? {}),
    },
    meta: {
      ...(ctx.event.meta ?? {}),
      ...(fields.meta ?? {}),
    },
  }
}

export function summarizeText(
  value: string,
  opts: { debug: boolean; policy: WideEventPayloadPolicy },
): Record<string, unknown> {
  const trimmed = value.trim()
  const summary: Record<string, unknown> = {
    length: trimmed.length,
    hash: hashValue(trimmed),
  }
  if (opts.policy === "full" || (opts.policy === "debug" && opts.debug)) {
    summary.preview = trimmed.slice(0, 240)
  }
  return summary
}

function shouldKeepEvent(ctx: WideEventContext, durationMs: number) {
  if (ctx.debug) return { kept: true, reason: "debug" }
  if (ctx.event.outcome === "error") return { kept: true, reason: "error" }
  if (durationMs >= ctx.slowMs) return { kept: true, reason: "slow" }
  const rate = Math.max(0, Math.min(1, ctx.sampleRate))
  return { kept: Math.random() < rate, reason: "sample", rate }
}

async function appendWideEventLine(filePath: string, line: string) {
  const resolved = path.resolve(filePath)
  const prev = writesByPath.get(resolved) ?? Promise.resolve()
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(resolved), { recursive: true })
      await fs.appendFile(resolved, line, "utf8")
    })
  writesByPath.set(resolved, next)
  await next
}

export async function finishWideEvent(params: {
  ok: boolean
  error?: { code?: string; message?: string } | Error
  meta?: Record<string, unknown>
}) {
  const ctx = storage.getStore()
  if (!ctx || ctx.finished) return
  ctx.finished = true
  const durationMs = Date.now() - ctx.startMs
  ctx.event.durationMs = durationMs
  ctx.event.outcome = params.ok ? "ok" : "error"
  ctx.event.slow = durationMs >= ctx.slowMs
  if (params.meta && Object.keys(params.meta).length > 0) {
    ctx.event.meta = { ...(ctx.event.meta ?? {}), ...params.meta }
  }
  if (params.error) {
    const err = params.error instanceof Error ? { message: params.error.message } : params.error
    ctx.event.error = {
      code: err.code,
      message: err.message,
    }
  }

  const decision = shouldKeepEvent(ctx, durationMs)
  ctx.event.sample = {
    kept: decision.kept,
    reason: decision.reason,
    rate: decision.rate,
  }
  if (!decision.kept) return

  const line = `${JSON.stringify(ctx.event)}\n`
  try {
    await appendWideEventLine(ctx.file, line)
  } catch {
    // ignore logging failures
  }
}
