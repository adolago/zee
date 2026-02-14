/**
 * Zee Messaging Tool - Plugin wrapper for cross-platform messaging
 *
 * WhatsApp: sends via meta-cli (Business API)
 * Telegram: sends via zee daemon gateway
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { tool } from "@zee/plugin"

type MetaCliResult = {
  success: boolean
  messageId?: string
  error?: string
  code?: "not_found" | "timeout" | "auth_failed" | "api_error" | "failed"
}

function normalizeRecipientForMetaCli(raw: string): string | { error: string } {
  const trimmed = raw.trim().replace(/^whatsapp:/i, "")
  if (trimmed.endsWith("@g.us")) {
    return { error: "Group JIDs (@g.us) are not supported by the Business API." }
  }

  const jidMatch = /^(\+?\d+)(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/i.exec(trimmed)
  if (jidMatch?.[1]) return `+${jidMatch[1].replace(/\D/g, "")}`

  if (/^\+\d{7,15}$/.test(trimmed)) return trimmed

  const digits = trimmed.replace(/\D/g, "")
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`

  return trimmed
}

function resolveMetaCliBin(): string[] {
  const home = os.homedir()
  const candidates = [
    process.env.ZEE_META_CLI_BIN,
    path.join(home, ".bun", "bin", "meta"),
    path.join(home, ".local", "bin", "meta"),
    "meta",
  ]

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

function inferMediaType(urlOrPath: string): "image" | "video" | "document" {
  const ext = path.extname(urlOrPath).toLowerCase().replace(".", "")
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image"
  if (["mp4", "3gp"].includes(ext)) return "video"
  return "document"
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<{
  ok: boolean
  stdout: string
  stderr: string
  notFound?: boolean
  timedOut?: boolean
}> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })

    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)

    const finish = (result: { ok: boolean; stdout: string; stderr: string; notFound?: boolean; timedOut?: boolean }) => {
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
      finish({ ok: false, stdout, stderr, notFound: nodeError.code === "ENOENT" })
    })

    child.on("close", (code) => {
      finish({ ok: code === 0, stdout, stderr, timedOut })
    })
  })
}

async function sendWhatsAppViaMetaCli(to: string, message: string, mediaUrl?: string, mediaType?: "image" | "video" | "document"): Promise<MetaCliResult> {
  const normalized = normalizeRecipientForMetaCli(to)
  if (typeof normalized === "object" && "error" in normalized) {
    return { success: false, code: "failed", error: normalized.error }
  }

  const args = ["wa", "send", normalized]
  if (mediaUrl) {
    const type = mediaType ?? inferMediaType(mediaUrl)
    args.push(`--${type}`, mediaUrl)
    if (message) args.push("--caption", message)
  } else {
    args.push("--text", message)
  }
  args.push("--json")

  for (const candidate of resolveMetaCliBin()) {
    if (!commandExists(candidate)) continue

    const result = await runCommand(candidate, args, 30_000)
    if (result.notFound) continue

    if (result.timedOut) {
      return { success: false, code: "timeout", error: "meta-cli timed out after 30s" }
    }

    if (result.ok) {
      try {
        const data = JSON.parse(result.stdout)
        return { success: true, messageId: data?.messages?.[0]?.id }
      } catch {
        return { success: true }
      }
    }

    const output = result.stderr.trim()
    const lower = output.toLowerCase()
    if (lower.includes("auth") || lower.includes("token") || lower.includes("unauthorized")) {
      return { success: false, code: "auth_failed", error: output || "meta-cli auth failed" }
    }

    return { success: false, code: "failed", error: output || "meta-cli send failed" }
  }

  return { success: false, code: "not_found", error: "meta binary not found. Install meta-cli or set ZEE_META_CLI_BIN." }
}

export default tool({
  description: `Send messages via WhatsApp (Business API) or Telegram gateways.

Channels:
- **whatsapp**: sends via meta-cli (WhatsApp Business Cloud API)
- **telegram**: Telegram bots (requires zee daemon with gateway enabled)

WhatsApp:
- to: E.164 phone (e.g., "+1555..."). Groups not supported.
- Supports media: image, video, document via mediaUrl

Telegram:
- to: Chat ID (numeric) or @username
- persona: Which bot/account to use - "stanley" (default) or "johny"

Examples:
- WhatsApp: { channel: "whatsapp", to: "+15551234567", message: "Hello!" }
- WhatsApp media: { channel: "whatsapp", to: "+15551234567", message: "Check this", mediaUrl: "/tmp/photo.jpg" }
- Telegram via Stanley: { channel: "telegram", to: "123456789", message: "Market update!", persona: "stanley" }`,
  args: {
    channel: tool.schema
      .enum(["whatsapp", "telegram"])
      .describe("Messaging channel: whatsapp or telegram"),
    to: tool.schema.string().describe("Recipient: WhatsApp E.164 phone or Telegram chatId (numeric)"),
    message: tool.schema.string().describe("Message content"),
    persona: tool.schema
      .enum(["zee", "stanley", "johny"])
      .optional()
      .describe("For Telegram: which persona's bot to use (default: stanley)"),
    mediaUrl: tool.schema
      .string()
      .optional()
      .describe("For WhatsApp: URL or path to media file (image, video, document)"),
    mediaType: tool.schema
      .enum(["image", "video", "document"])
      .optional()
      .describe("For WhatsApp: media type (auto-detected from extension if omitted)"),
  },
  async execute(args) {
    const { channel, to, message, persona, mediaUrl, mediaType } = args

    const rawBaseUrl =
      process.env.ZEE_URL ||
      process.env.ZEE_DAEMON_URL ||
      `http://127.0.0.1:${process.env.ZEE_PORT || "3210"}`
    const baseUrl = rawBaseUrl.replace(/\/$/, "")

    try {
      if (channel === "whatsapp") {
        const result = await sendWhatsAppViaMetaCli(to, message, mediaUrl, mediaType as "image" | "video" | "document" | undefined)

        if (result.success) {
          const mediaLabel = mediaUrl ? " with media" : ""
          return `Message sent via WhatsApp (meta-cli)${mediaLabel} to ${to}
${result.messageId ? `Message ID: ${result.messageId}\n` : ""}
Preview: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`
        }

        const troubleshooting = result.code === "not_found"
          ? `- Install meta-cli: \`bun add -g @anthropic/meta-cli\`
- Or set ZEE_META_CLI_BIN`
          : result.code === "auth_failed"
            ? `- Run \`meta auth login\` to re-authenticate
- Verify: \`meta doctor\``
            : `- Run \`meta doctor\` to check configuration
- Verify \`meta wa send\` works manually`

        return `Failed to send WhatsApp message: ${result.error || "Unknown error"}

Troubleshooting:
${troubleshooting}`

      } else if (channel === "telegram") {
        // Send via Telegram gateway (Stanley/Johny bots)
        const selectedPersona = persona || "stanley"
        const chatId = parseInt(to, 10)

        if (isNaN(chatId)) {
          return `Invalid Telegram chat ID: "${to}"

Chat ID must be a numeric value (e.g., 123456789).`
        }

        const response = await fetch(`${baseUrl}/gateway/telegram/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona: selectedPersona, chatId, message }),
        })

        if (!response.ok) {
          const error = await response.text()
          return `Failed to send Telegram message via ${selectedPersona}: ${error}

Troubleshooting:
- Ensure \`zee daemon\` is running
- Check \`zee debug status\` shows Gateway: Active
- Verify chatId is numeric`
        }

        const result = await response.json()
        if (!result.success) {
          return `Failed to send Telegram message via ${selectedPersona}: ${result.error || "Unknown error"}`
        }

        return `Message sent via Telegram (${selectedPersona} bot) to chat ${to}

Preview: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`
      }

      return `Channel "${channel}" is not supported. Use "whatsapp" or "telegram".`
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)

      return `Failed to send message: ${errorMsg}

Troubleshooting:
- Ensure zee daemon is running
- Check gateway status with /status command
- Verify network connectivity`
    }
  },
})
