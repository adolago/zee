import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export type MetaCliSendErrorCode =
  | "META_CLI_NOT_FOUND"
  | "META_CLI_TIMEOUT"
  | "META_CLI_AUTH_FAILED"
  | "META_CLI_API_ERROR"
  | "META_CLI_FAILED"

export type MetaCliSendResult =
  | {
      success: true
      messageId?: string
      waId?: string
    }
  | {
      success: false
      code: MetaCliSendErrorCode
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

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Normalize a recipient to E.164 format for the Business API.
 * Strips JID suffixes (@s.whatsapp.net, @c.us), ensures leading '+'.
 * Rejects group JIDs (@g.us) since the Business API doesn't support groups.
 */
export function normalizeRecipientForMetaCli(rawRecipient: string): string | { error: string } {
  const trimmed = rawRecipient.trim()
  if (!trimmed) return { error: "Empty recipient" }

  const withoutPrefix = trimmed.replace(/^whatsapp:/i, "").trim()

  if (withoutPrefix.endsWith("@g.us")) {
    return { error: "Group JIDs (@g.us) are not supported by the Business API. Use individual numbers only." }
  }

  // Strip JID suffixes: 1234567890@s.whatsapp.net or 1234567890@c.us → 1234567890
  const jidMatch = /^(\+?\d+)(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/i.exec(withoutPrefix)
  if (jidMatch?.[1]) {
    const digits = jidMatch[1].replace(/\D/g, "")
    return `+${digits}`
  }

  // Already E.164 with +
  if (/^\+\d{7,15}$/.test(withoutPrefix)) {
    return withoutPrefix
  }

  // Bare digits → add +
  const digits = withoutPrefix.replace(/\D/g, "")
  if (digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`
  }

  return withoutPrefix
}

/**
 * Resolve the meta-cli binary path using candidate list.
 * Priority: ZEE_META_CLI_BIN env → well-known paths → PATH
 */
function resolveMetaCliBin(): string[] {
  const home = os.homedir()
  const fromEnv = [process.env.ZEE_META_CLI_BIN]
  const defaults = [
    path.join(home, ".bun", "bin", "meta"),
    path.join(home, ".local", "bin", "meta"),
    "meta",
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
 * Infer media type from file extension.
 * jpg/jpeg/png/webp/gif → image, mp4/3gp → video, else → document
 */
export function inferMediaType(urlOrPath: string): MediaType {
  const ext = path.extname(urlOrPath).toLowerCase().replace(".", "")
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image"
  if (["mp4", "3gp"].includes(ext)) return "video"
  return "document"
}

/**
 * Build meta-cli arguments for a send command.
 * Text: meta wa send <to> --text <msg> --json
 * Media: meta wa send <to> --<type> <url> --caption <msg> --json
 */
function buildMetaCliArgs(options: {
  to: string
  message: string
  mediaUrl?: string
  mediaType?: MediaType
  caption?: string
}): string[] {
  const args = ["wa", "send", options.to]

  if (options.mediaUrl) {
    const type = options.mediaType ?? inferMediaType(options.mediaUrl)
    args.push(`--${type}`, options.mediaUrl)
    const captionText = options.caption ?? options.message
    if (captionText) {
      args.push("--caption", captionText)
    }
  } else {
    args.push("--text", options.message)
  }

  args.push("--json")
  return args
}

/**
 * Parse meta-cli JSON stdout on success (exit 0).
 * Extracts messages[0].id and contacts[0].wa_id.
 */
function parseMetaCliOutput(stdout: string): { messageId?: string; waId?: string } {
  try {
    const data = JSON.parse(stdout)
    return {
      messageId: data?.messages?.[0]?.id,
      waId: data?.contacts?.[0]?.wa_id,
    }
  } catch {
    return {}
  }
}

function classifyMetaCliError(stderr: string, exitCode: number | null): {
  code: MetaCliSendErrorCode
  error: string
} {
  const text = stderr.trim()
  const lower = text.toLowerCase()

  // Auth / credential failures
  if (
    exitCode === 2 ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("invalid token") ||
    lower.includes("token expired") ||
    lower.includes("oauth") ||
    lower.includes("not authenticated") ||
    lower.includes("access token") ||
    lower.includes("auth")
  ) {
    return { code: "META_CLI_AUTH_FAILED", error: text || "meta-cli authentication failed" }
  }

  // API-level errors (bad request, rate limit, recipient issues)
  if (
    lower.includes("400") ||
    lower.includes("403") ||
    lower.includes("404") ||
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("invalid recipient") ||
    lower.includes("not a valid whatsapp") ||
    lower.includes("template") ||
    lower.includes("messaging limit") ||
    lower.includes("outside allowed window") ||
    lower.includes("spam") ||
    lower.includes("blocked")
  ) {
    return { code: "META_CLI_API_ERROR", error: text || "meta-cli API request failed" }
  }

  return { code: "META_CLI_FAILED", error: text || "meta-cli send failed" }
}

export function commandExists(command: string): boolean {
  if (!path.isAbsolute(command)) return true
  try {
    fs.accessSync(command, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function runCommand(
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

export async function sendWhatsAppMessage(options: SendWhatsAppOptions): Promise<MetaCliSendResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Normalize recipient to E.164
  const normalized = normalizeRecipientForMetaCli(options.to)
  if (typeof normalized === "object" && "error" in normalized) {
    return {
      success: false,
      code: "META_CLI_FAILED",
      error: normalized.error,
    }
  }

  const cliArgs = buildMetaCliArgs({
    to: normalized,
    message: options.message,
    mediaUrl: options.mediaUrl,
    mediaType: options.mediaType,
    caption: options.caption,
  })

  const candidates = resolveMetaCliBin()
  const attempted: string[] = []

  for (const candidate of candidates) {
    if (!commandExists(candidate)) continue
    attempted.push(candidate)

    const result = await runCommand(candidate, cliArgs, timeoutMs)

    if (result.notFound) continue

    if (result.timedOut) {
      return {
        success: false,
        code: "META_CLI_TIMEOUT",
        error: `meta-cli timed out after ${timeoutMs}ms`,
      }
    }

    if (result.ok) {
      const parsed = parseMetaCliOutput(result.stdout)
      return {
        success: true,
        messageId: parsed.messageId,
        waId: parsed.waId,
      }
    }

    return {
      success: false,
      ...classifyMetaCliError(result.stderr, result.exitCode),
    }
  }

  return {
    success: false,
    code: "META_CLI_NOT_FOUND",
    error:
      attempted.length > 0
        ? `meta-cli was attempted but unavailable (${attempted.join(", ")})`
        : "meta binary not found. Install meta-cli or set ZEE_META_CLI_BIN.",
  }
}
