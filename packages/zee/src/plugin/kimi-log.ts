import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

const LOG_NAME = "kimi.log"
const ROTATION_HOUR = 6
const RETENTION_DAYS = 10

let nextRotationAt = 0
let writeChain: Promise<void> = Promise.resolve()
let stderrInstalled = false
let originalStderrWrite: typeof process.stderr.write | null = null
let stderrBuffer = ""

function logPath() {
  return path.join(Global.Path.log, LOG_NAME)
}

function computeNextRotation(nowMs: number) {
  const next = new Date(nowMs)
  next.setHours(ROTATION_HOUR, 0, 0, 0)
  if (next.getTime() <= nowMs) {
    next.setDate(next.getDate() + 1)
  }
  return next.getTime()
}

async function ensureRotation(nowMs: number) {
  if (!nextRotationAt) {
    nextRotationAt = computeNextRotation(nowMs)
    await cleanupOldLogs(nowMs)
  }
  if (nowMs < nextRotationAt) return

  const currentPath = logPath()
  const dateStamp = new Date(nowMs).toISOString().slice(0, 10)
  let rotatedPath = path.join(Global.Path.log, `kimi-${dateStamp}.log`)
  let suffix = 1

  while (true) {
    try {
      await fs.access(rotatedPath)
      rotatedPath = path.join(Global.Path.log, `kimi-${dateStamp}-${suffix}.log`)
      suffix += 1
    } catch {
      break
    }
  }

  await fs.rename(currentPath, rotatedPath).catch(() => {})
  nextRotationAt = computeNextRotation(nowMs + 1000)
  await cleanupOldLogs(nowMs)
}

async function cleanupOldLogs(nowMs: number) {
  const cutoff = nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000
  const entries = await fs.readdir(Global.Path.log).catch(() => [])
  const candidates = entries.filter((entry) => /^kimi-\d{4}-\d{2}-\d{2}(-\d+)?\.log$/.test(entry))
  await Promise.all(
    candidates.map(async (entry) => {
      const filePath = path.join(Global.Path.log, entry)
      const stat = await fs.stat(filePath).catch(() => null)
      if (!stat) return
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath).catch(() => {})
      }
    }),
  )
}

function formatLine(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const timestamp = new Date().toISOString()
  const clean = message.replace(/\r?\n$/, "")
  if (meta && Object.keys(meta).length > 0) {
    return `${timestamp} ${level} ${clean} ${JSON.stringify(meta)}\n`
  }
  return `${timestamp} ${level} ${clean}\n`
}

function enqueueWrite(line: string) {
  writeChain = writeChain.then(async () => {
    const nowMs = Date.now()
    await ensureRotation(nowMs)
    await fs.appendFile(logPath(), line).catch(() => {})
  })
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  enqueueWrite(formatLine(level, message, meta))
}

export const KimiLog = {
  debug(message: string, meta?: Record<string, unknown>) {
    log("DEBUG", message, meta)
  },
  info(message: string, meta?: Record<string, unknown>) {
    log("INFO", message, meta)
  },
  warn(message: string, meta?: Record<string, unknown>) {
    log("WARN", message, meta)
  },
  error(message: string, meta?: Record<string, unknown>) {
    log("ERROR", message, meta)
  },
}

function flushStderrLines() {
  let index = stderrBuffer.indexOf("\n")
  while (index >= 0) {
    const line = stderrBuffer.slice(0, index).replace(/\r$/, "")
    stderrBuffer = stderrBuffer.slice(index + 1)
    if (line.trim()) {
      KimiLog.error(line, { source: "stderr" })
    }
    index = stderrBuffer.indexOf("\n")
  }
}

export function installKimiStderrRedirect(options?: { enabled?: boolean }) {
  if (stderrInstalled) return
  if (options?.enabled === false) return
  stderrInstalled = true

  originalStderrWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: any, encoding?: any, callback?: any) => {
    const text =
      typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString(encoding ?? "utf8")
    stderrBuffer += text
    flushStderrLines()
    if (!originalStderrWrite) return true
    return originalStderrWrite(chunk, encoding as any, callback as any)
  }) as typeof process.stderr.write
}
