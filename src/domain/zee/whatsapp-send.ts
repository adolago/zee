import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export type WhatsAppTransport = "auto" | "wacli" | "gateway"
export type WhatsAppResolvedTransport = Exclude<WhatsAppTransport, "auto">

export type WhatsAppSendErrorCode =
  | "WACLI_NOT_FOUND"
  | "WACLI_LOCKED"
  | "WACLI_NOT_AUTHENTICATED"
  | "WACLI_FAILED"
  | "WACLI_UNSUPPORTED_MEDIA"
  | "GATEWAY_UNAVAILABLE"
  | "GATEWAY_FAILED"

export type WhatsAppSendResult =
  | {
      success: true
      transport: WhatsAppResolvedTransport
      output?: string
    }
  | {
      success: false
      transport: WhatsAppResolvedTransport
      code: WhatsAppSendErrorCode
      error: string
      output?: string
    }

export type SendWhatsAppOptions = {
  to: string
  message: string
  accountId?: string
  mediaUrl?: string
  baseUrl?: string
  transport?: WhatsAppTransport
  timeoutMs?: number
}

type CommandResult = {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  error?: string
  notFound?: boolean
  timedOut?: boolean
}

const DEFAULT_TIMEOUT_MS = 30_000

function resolveBaseUrl(raw?: string): string {
  const fromEnv =
    raw ||
    process.env.ZEE_URL ||
    process.env.ZEE_DAEMON_URL ||
    `http://127.0.0.1:${process.env.ZEE_PORT || process.env.ZEE_DAEMON_PORT || "3210"}`
  return fromEnv.replace(/\/$/, "")
}

function normalizePhoneDigits(raw: string): string {
  return raw.replace(/\D/g, "")
}

export function normalizeRecipientForWacli(rawRecipient: string): string {
  const trimmed = rawRecipient.trim()
  if (!trimmed) return trimmed

  const withoutPrefix = trimmed.replace(/^whatsapp:/i, "").trim()
  if (withoutPrefix.endsWith("@g.us")) return withoutPrefix

  const cUsMatch = /^(\+?\d+)(?::\d+)?@c\.us$/i.exec(withoutPrefix)
  if (cUsMatch?.[1]) {
    return `${normalizePhoneDigits(cUsMatch[1])}@s.whatsapp.net`
  }

  const sWaMatch = /^(\+?\d+)(?::\d+)?@s\.whatsapp\.net$/i.exec(withoutPrefix)
  if (sWaMatch?.[1]) {
    return `${normalizePhoneDigits(sWaMatch[1])}@s.whatsapp.net`
  }

  if (withoutPrefix.includes("@")) return withoutPrefix

  const digits = normalizePhoneDigits(withoutPrefix)
  if (!digits) return withoutPrefix
  return `${digits}@s.whatsapp.net`
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })

    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)

    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })

    child.on("error", (error) => {
      const nodeError = error as NodeJS.ErrnoException
      finish({
        ok: false,
        exitCode: null,
        stdout,
        stderr,
        error: error.message,
        notFound: nodeError.code === "ENOENT",
      })
    })

    child.on("close", (code) => {
      finish({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
        timedOut,
      })
    })
  })
}

function parseWacliError(output: string): {
  code: Exclude<WhatsAppSendErrorCode, "WACLI_NOT_FOUND" | "GATEWAY_UNAVAILABLE" | "GATEWAY_FAILED">
  error: string
} {
  const lower = output.toLowerCase()
  if (lower.includes("store is locked")) {
    return {
      code: "WACLI_LOCKED",
      error: "wacli store is locked. Stop any running `wacli sync --follow` process and retry.",
    }
  }
  if (lower.includes("not authenticated")) {
    return {
      code: "WACLI_NOT_AUTHENTICATED",
      error: "wacli is not authenticated. Run `~/go/bin/wacli auth` and retry.",
    }
  }
  return {
    code: "WACLI_FAILED",
    error: output.trim() || "wacli send failed",
  }
}

function resolveWacliCandidates(): string[] {
  const home = os.homedir()
  const fromEnv = [process.env.ZEE_WACLI_BIN, process.env.WACLI_BIN]
  const defaults = [
    path.join(home, "go", "bin", "wacli"),
    path.join(home, ".local", "bin", "wacli"),
    "wacli",
  ]
  const candidates = [...fromEnv, ...defaults]
  const unique = new Set<string>()
  const resolved: string[] = []
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (!value || unique.has(value)) continue
    unique.add(value)
    resolved.push(value)
  }
  return resolved
}

function commandExists(command: string): boolean {
  if (!path.isAbsolute(command)) return true
  try {
    fs.accessSync(command, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function sendViaWacli(options: {
  to: string
  message: string
  timeoutMs: number
  mediaUrl?: string
}): Promise<WhatsAppSendResult> {
  if (options.mediaUrl) {
    return {
      success: false,
      transport: "wacli",
      code: "WACLI_UNSUPPORTED_MEDIA",
      error: "wacli transport does not support mediaUrl in this tool path. Use gateway transport for media sends.",
    }
  }

  const to = normalizeRecipientForWacli(options.to)
  const args = ["send", "text", "--to", to, "--message", options.message]
  const candidates = resolveWacliCandidates()
  const attempted: string[] = []

  for (const candidate of candidates) {
    if (!commandExists(candidate)) continue
    attempted.push(candidate)
    const result = await runCommand(candidate, args, options.timeoutMs)

    if (result.notFound) continue

    const output = `${result.stdout}\n${result.stderr}`.trim()
    if (result.ok) {
      return {
        success: true,
        transport: "wacli",
        output,
      }
    }

    const parsed = parseWacliError(output)
    return {
      success: false,
      transport: "wacli",
      code: parsed.code,
      error: parsed.error,
      output,
    }
  }

  return {
    success: false,
    transport: "wacli",
    code: "WACLI_NOT_FOUND",
    error:
      attempted.length > 0
        ? `wacli was attempted but unavailable (${attempted.join(", ")})`
        : "wacli binary not found. Install it or set ZEE_WACLI_BIN.",
  }
}

async function sendViaGateway(options: {
  to: string
  message: string
  accountId: string
  baseUrl: string
  mediaUrl?: string
}): Promise<WhatsAppSendResult> {
  try {
    const response = await fetch(`${options.baseUrl}/gateway/whatsapp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: options.to,
        message: options.message,
        accountId: options.accountId,
        ...(options.mediaUrl ? { mediaUrl: options.mediaUrl } : {}),
      }),
    })

    const raw = await response.json().catch(() => null)
    const success = Boolean(raw && typeof raw === "object" && (raw as { success?: boolean }).success)

    if (!success) {
      const error =
        raw && typeof raw === "object" && typeof (raw as { error?: unknown }).error === "string"
          ? (raw as { error: string }).error
          : `Gateway request failed with status ${response.status}`
      return {
        success: false,
        transport: "gateway",
        code: "GATEWAY_FAILED",
        error,
        output: raw ? JSON.stringify(raw) : undefined,
      }
    }

    return {
      success: true,
      transport: "gateway",
      output: raw ? JSON.stringify(raw) : undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      transport: "gateway",
      code: "GATEWAY_UNAVAILABLE",
      error: message,
    }
  }
}

export async function sendWhatsAppMessage(options: SendWhatsAppOptions): Promise<WhatsAppSendResult> {
  const transport = options.transport ?? "auto"
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const accountId = options.accountId ?? "zee"
  const baseUrl = resolveBaseUrl(options.baseUrl)

  if (transport === "gateway") {
    return await sendViaGateway({
      to: options.to,
      message: options.message,
      mediaUrl: options.mediaUrl,
      accountId,
      baseUrl,
    })
  }

  if (transport === "wacli") {
    return await sendViaWacli({
      to: options.to,
      message: options.message,
      mediaUrl: options.mediaUrl,
      timeoutMs,
    })
  }

  if (options.mediaUrl) {
    return await sendViaGateway({
      to: options.to,
      message: options.message,
      mediaUrl: options.mediaUrl,
      accountId,
      baseUrl,
    })
  }

  const wacliResult = await sendViaWacli({
    to: options.to,
    message: options.message,
    timeoutMs,
  })

  if (wacliResult.success) {
    return wacliResult
  }

  if (wacliResult.code === "WACLI_NOT_FOUND") {
    return await sendViaGateway({
      to: options.to,
      message: options.message,
      mediaUrl: options.mediaUrl,
      accountId,
      baseUrl,
    })
  }

  return wacliResult
}
