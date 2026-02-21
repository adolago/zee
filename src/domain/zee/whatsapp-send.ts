import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export type WacliSendErrorCode =
  | "WACLI_NOT_FOUND"
  | "WACLI_TIMEOUT"
  | "WACLI_AUTH_FAILED"
  | "WACLI_SEND_FAILED"

export type WacliSendResult =
  | {
      success: true
      messageId?: string
    }
  | {
      success: false
      code: WacliSendErrorCode
      error: string
    }

export type MediaType = "image" | "video" | "document"

export type SendWhatsAppOptions = {
  to: string
  message: string
  mediaUrl?: string
  mediaType?: MediaType
  caption?: string
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

const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Normalize a recipient to a wacli JID.
 * Accepts: E.164 (+436649137379), bare digits (436649137379),
 * or already-formed JID (436649137379@s.whatsapp.net).
 * Rejects group JIDs (@g.us).
 */
export function normalizeRecipientForWacli(rawRecipient: string): string | { error: string } {
  const trimmed = rawRecipient.trim()
  if (!trimmed) return { error: "Empty recipient" }

  const withoutPrefix = trimmed.replace(/^whatsapp:/i, "").trim()

  if (withoutPrefix.endsWith("@g.us")) {
    return { error: "Group JIDs (@g.us) are not supported. Use individual numbers only." }
  }

  // Already a full JID
  if (withoutPrefix.endsWith("@s.whatsapp.net") || withoutPrefix.endsWith("@c.us")) {
    return withoutPrefix
  }

  // Strip leading + and non-digits, form JID
  const digits = withoutPrefix.replace(/\D/g, "")
  if (digits.length >= 7 && digits.length <= 15) {
    return `${digits}@s.whatsapp.net`
  }

  return { error: `Invalid phone number: "${rawRecipient}"` }
}

/**
 * Resolve the wacli binary path.
 * Priority: ZEE_WACLI_BIN env > WACLI_BIN env > well-known paths > PATH
 */
function resolveWacliBin(): string[] {
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

/**
 * Resolve the wacli store directory.
 */
function resolveWacliStore(): string {
  return process.env.WACLI_STORE || path.join(os.homedir(), ".wacli")
}

/**
 * Infer media type from file extension.
 * jpg/jpeg/png/webp/gif -> image, mp4/3gp -> video, else -> document
 */
export function inferMediaType(urlOrPath: string): MediaType {
  const ext = path.extname(urlOrPath).toLowerCase().replace(".", "")
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image"
  if (["mp4", "3gp"].includes(ext)) return "video"
  return "document"
}

/**
 * Build wacli arguments for a send command.
 * Text: wacli send text --to <jid> --message <msg> --store <store> --json
 * Media: wacli send <type> --to <jid> --path <file> --caption <msg> --store <store> --json
 */
function buildWacliArgs(options: {
  to: string
  message: string
  mediaUrl?: string
  mediaType?: MediaType
  caption?: string
}): string[] {
  const store = resolveWacliStore()

  if (options.mediaUrl) {
    const type = options.mediaType ?? inferMediaType(options.mediaUrl)
    const args = ["send", type, "--to", options.to, "--path", options.mediaUrl, "--store", store]
    const captionText = options.caption ?? options.message
    if (captionText) {
      args.push("--caption", captionText)
    }
    args.push("--timeout", "2m", "--json")
    return args
  }

  return ["send", "text", "--to", options.to, "--message", options.message, "--store", store, "--timeout", "2m", "--json"]
}

/**
 * Parse wacli JSON stdout on success (exit 0).
 * Extracts data.id from the response.
 */
function parseWacliOutput(stdout: string): { messageId?: string } {
  try {
    const data = JSON.parse(stdout)
    return {
      messageId: data?.data?.id || data?.id,
    }
  } catch {
    return {}
  }
}

function classifyWacliError(stderr: string, stdout: string, exitCode: number | null): {
  code: WacliSendErrorCode
  error: string
} {
  const text = (stderr.trim() || stdout.trim())
  const lower = text.toLowerCase()

  if (
    lower.includes("not authenticated") ||
    lower.includes("not logged in") ||
    lower.includes("qr") ||
    lower.includes("pair") ||
    lower.includes("session expired")
  ) {
    return { code: "WACLI_AUTH_FAILED", error: text || "wacli not authenticated" }
  }

  return { code: "WACLI_SEND_FAILED", error: text || "wacli send failed" }
}

export function commandExists(command: string): boolean {
  if (!path.isAbsolute(command)) return true
  const mode = process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK
  try {
    fs.accessSync(command, mode)
    return true
  } catch {
    return false
  }
}

export async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  envOverrides?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const mergedEnv = { ...process.env, ...(envOverrides ?? {}) }
  const resolvedEnv = Object.fromEntries(
    Object.entries(mergedEnv)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )

  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: resolvedEnv,
      shell: false,
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

export async function sendWhatsAppMessage(options: SendWhatsAppOptions): Promise<WacliSendResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Normalize recipient to JID
  const normalized = normalizeRecipientForWacli(options.to)
  if (typeof normalized === "object" && "error" in normalized) {
    return {
      success: false,
      code: "WACLI_SEND_FAILED",
      error: normalized.error,
    }
  }

  const cliArgs = buildWacliArgs({
    to: normalized,
    message: options.message,
    mediaUrl: options.mediaUrl,
    mediaType: options.mediaType,
    caption: options.caption,
  })

  const candidates = resolveWacliBin()
  const attempted: string[] = []

  for (const candidate of candidates) {
    if (!commandExists(candidate)) continue
    attempted.push(candidate)

    const result = await runCommand(candidate, cliArgs, timeoutMs)

    if (result.notFound) continue

    if (result.timedOut) {
      return {
        success: false,
        code: "WACLI_TIMEOUT",
        error: `wacli timed out after ${timeoutMs}ms`,
      }
    }

    if (result.ok) {
      const parsed = parseWacliOutput(result.stdout)
      return {
        success: true,
        messageId: parsed.messageId,
      }
    }

    return {
      success: false,
      ...classifyWacliError(result.stderr, result.stdout, result.exitCode),
    }
  }

  return {
    success: false,
    code: "WACLI_NOT_FOUND",
    error:
      attempted.length > 0
        ? `wacli was attempted but unavailable (${attempted.join(", ")})`
        : "wacli binary not found. Install wacli or set ZEE_WACLI_BIN.",
  }
}

// Legacy type aliases for backward compatibility during migration
export type MetaCliSendErrorCode = WacliSendErrorCode
export type MetaCliSendResult = WacliSendResult
