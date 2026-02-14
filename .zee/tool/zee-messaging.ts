/**
 * Zee Messaging Tool - Plugin wrapper for cross-platform messaging
 *
 * Wraps the Zee messaging tool in the plugin format.
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { tool } from "@zee/plugin"

type WacliResult = {
  success: boolean
  error?: string
  code?: "not_found" | "locked" | "not_authenticated" | "failed"
}

function normalizeRecipientForWacli(raw: string): string {
  const trimmed = raw.trim().replace(/^whatsapp:/i, "")
  if (trimmed.endsWith("@g.us")) return trimmed

  const cUsMatch = /^(\+?\d+)(?::\d+)?@c\.us$/i.exec(trimmed)
  if (cUsMatch?.[1]) return `${cUsMatch[1].replace(/\D/g, "")}@s.whatsapp.net`

  const sWaMatch = /^(\+?\d+)(?::\d+)?@s\.whatsapp\.net$/i.exec(trimmed)
  if (sWaMatch?.[1]) return `${sWaMatch[1].replace(/\D/g, "")}@s.whatsapp.net`

  if (trimmed.includes("@")) return trimmed

  const digits = trimmed.replace(/\D/g, "")
  return digits ? `${digits}@s.whatsapp.net` : trimmed
}

function resolveWacliCandidates(): string[] {
  const home = os.homedir()
  const candidates = [
    process.env.ZEE_WACLI_BIN,
    process.env.WACLI_BIN,
    path.join(home, "go", "bin", "wacli"),
    path.join(home, ".local", "bin", "wacli"),
    "wacli",
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

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<{
  ok: boolean
  stdout: string
  stderr: string
  notFound?: boolean
}> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })

    let stdout = ""
    let stderr = ""
    let settled = false

    const timer = setTimeout(() => {
      child.kill("SIGKILL")
    }, timeoutMs)

    const finish = (result: { ok: boolean; stdout: string; stderr: string; notFound?: boolean }) => {
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
      finish({ ok: code === 0, stdout, stderr })
    })
  })
}

async function sendWhatsAppViaWacli(to: string, message: string): Promise<WacliResult> {
  const jid = normalizeRecipientForWacli(to)
  const args = ["send", "text", "--to", jid, "--message", message]

  for (const candidate of resolveWacliCandidates()) {
    if (!commandExists(candidate)) continue

    const result = await runCommand(candidate, args, 30_000)
    if (result.notFound) continue

    const output = `${result.stdout}\n${result.stderr}`.trim()
    if (result.ok) {
      return { success: true }
    }

    const lower = output.toLowerCase()
    if (lower.includes("store is locked")) {
      return {
        success: false,
        code: "locked",
        error: "wacli store is locked. Stop `wacli sync --follow` and retry.",
      }
    }
    if (lower.includes("not authenticated")) {
      return {
        success: false,
        code: "not_authenticated",
        error: "wacli is not authenticated. Run `~/go/bin/wacli auth` and retry.",
      }
    }

    return {
      success: false,
      code: "failed",
      error: output || "wacli send failed",
    }
  }

  return {
    success: false,
    code: "not_found",
    error: "wacli binary not found. Install it or set ZEE_WACLI_BIN.",
  }
}

export default tool({
  description: `Send messages via WhatsApp or Telegram gateways.

Channels:
- **whatsapp**: default transport is wacli (direct WhatsApp CLI)
- **telegram**: Telegram bots (requires zee daemon with gateway enabled)

WhatsApp:
- to: E164 phone (e.g., "+1555...") or chat JID (e.g., "1234567890@c.us" or "...@g.us")
- transport: "auto" (wacli first), "wacli", or "gateway"

Telegram:
- to: Chat ID (numeric) or @username
- persona: Which bot/account to use - "stanley" (default) or "johny"

Examples:
- WhatsApp: { channel: "whatsapp", to: "+15551234567", message: "Hello!" }
- Telegram via Stanley: { channel: "telegram", to: "123456789", message: "Market update!", persona: "stanley" }`,
  args: {
    channel: tool.schema
      .enum(["whatsapp", "telegram"])
      .describe("Messaging channel: whatsapp or telegram"),
    to: tool.schema.string().describe("Recipient: WhatsApp chatId/JID or Telegram chatId (numeric)"),
    message: tool.schema.string().describe("Message content"),
    persona: tool.schema
      .enum(["zee", "stanley", "johny"])
      .optional()
      .describe("For Telegram: which persona's bot to use (default: stanley)"),
    transport: tool.schema
      .enum(["auto", "wacli", "gateway"])
      .optional()
      .describe("For WhatsApp: transport strategy (default: auto = wacli first)"),
  },
  async execute(args) {
    const { channel, to, message, persona, transport } = args

    const rawBaseUrl =
      process.env.ZEE_URL ||
      process.env.ZEE_DAEMON_URL ||
      `http://127.0.0.1:${process.env.ZEE_PORT || "3210"}`
    const baseUrl = rawBaseUrl.replace(/\/$/, "")

    try {
      if (channel === "whatsapp") {
        const selectedTransport = transport || "auto"

        if (selectedTransport !== "gateway") {
          const wacliResult = await sendWhatsAppViaWacli(to, message)
          if (wacliResult.success) {
            return `Message sent via WhatsApp (wacli) to ${to}

Preview: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`
          }

          if (selectedTransport === "wacli" || wacliResult.code !== "not_found") {
            return `Failed to send WhatsApp message via wacli: ${wacliResult.error || "Unknown error"}

Troubleshooting:
- If locked, stop \`wacli sync --follow\`
- If unauthenticated, run \`~/go/bin/wacli auth\`
- Ensure \`~/go/bin/wacli\` exists`
          }
        }

        // Gateway fallback for explicit gateway transport or when wacli is unavailable.
        const response = await fetch(`${baseUrl}/gateway/whatsapp/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: to, message }),
        })

        if (!response.ok) {
          const error = await response.text()
          return `Failed to send WhatsApp message: ${error}

Troubleshooting:
- Ensure \`zee daemon\` is running
- Check \`zee debug status\` shows Gateway: Active
- Verify recipient format (E164 like "+1555..." or JID like "1234567890@c.us")`
        }

        const result = await response.json()
        if (!result.success) {
          return `Failed to send WhatsApp message: ${result.error || "Unknown error"}`
        }

        return `Message sent via WhatsApp (gateway) to ${to}

Preview: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`
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
