/**
 * WhatsApp Domain Tools
 *
 * Provides WhatsApp messaging via wacli (personal WhatsApp bridge).
 * All tools send from the user's personal WhatsApp number.
 */

import { z } from "zod"
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types"
import { sendWhatsAppMessage, type WacliSendErrorCode } from "./whatsapp-send.js"

function buildWacliTroubleshooting(code: WacliSendErrorCode): string {
  switch (code) {
    case "WACLI_NOT_FOUND":
      return `Troubleshooting:
1. Install wacli (Go binary)
2. Or set ZEE_WACLI_BIN to the binary path
3. Verify: \`wacli doctor --store ~/.wacli\``
    case "WACLI_TIMEOUT":
      return `Troubleshooting:
1. Check network connectivity
2. Verify wacli session: \`wacli doctor --store ~/.wacli\`
3. Re-pair if needed: \`wacli auth --store ~/.wacli\``
    case "WACLI_AUTH_FAILED":
      return `Troubleshooting:
1. Re-pair wacli: \`wacli auth --store ~/.wacli\`
2. Scan QR from WhatsApp > Linked Devices
3. Verify: \`wacli doctor --store ~/.wacli\``
    case "WACLI_SEND_FAILED":
      return `Troubleshooting:
1. Run \`wacli doctor --store ~/.wacli\` to check status
2. Verify wacli is authenticated
3. Check wacli store lock: remove ~/.wacli/LOCK if stale`
  }
}

function previewText(message: string): string {
  return `${message.substring(0, 100)}${message.length > 100 ? "..." : ""}`
}

async function sendFromAccount(params: {
  to: string
  message: string
  account: string
  mediaUrl?: string
  mediaType?: "image" | "video" | "document"
}): Promise<ToolExecutionResult> {
  const { to, message, account, mediaUrl, mediaType } = params
  const result = await sendWhatsAppMessage({
    to,
    message,
    mediaUrl,
    mediaType,
  })

  if (!result.success) {
    return {
      title: `WhatsApp Send Failed`,
      metadata: {
        to,
        account,
        error: result.error,
        errorCode: result.code,
      },
      output: `Failed to send via WhatsApp: ${result.error}

${buildWacliTroubleshooting(result.code)}`,
    }
  }

  const mediaLabel = mediaUrl ? " with media" : ""

  return {
    title: `Sent via WhatsApp`,
    metadata: {
      to,
      account,
      success: true,
      messageId: result.messageId,
    },
    output: `Message sent via WhatsApp to ${to}${mediaLabel}

Preview: "${previewText(message)}"${result.messageId ? `\nMessage ID: ${result.messageId}` : ""}`,
  }
}

// =============================================================================
// Send via WhatsApp (Personal Number via wacli)
// =============================================================================

const WhatsAppParams = z.object({
  to: z.string().describe("Recipient: phone number (e.g., +15551234567) or JID (e.g., 15551234567@s.whatsapp.net)"),
  message: z.string().describe("Message content to send"),
  mediaUrl: z.string().optional()
    .describe("URL or local path to media file (image, video, document)"),
  mediaType: z.enum(["image", "video", "document"]).optional()
    .describe("Media type (auto-detected from extension if omitted)"),
})

export const zeeWhatsAppTool: ToolDefinition = {
  id: "zee:whatsapp-zee",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via wacli (personal WhatsApp bridge).

**Recipient lookup workflow (ALWAYS follow this):**
1. If the user says "message <name>" without a number, call zee:memory-query with mode "filter", domain "contacts" and the person's name as query.
2. If no results, try zee:memory-query with mode "search" and the person's name as query.
3. Only ask the user for a phone number if both searches return nothing.
4. Then call this tool with the resolved \`to\` value.

Sends from your personal WhatsApp number via wacli linked device.

**When to use:**
- Default messaging from Zee
- Automated notifications
- Personal messaging

**Recipient format:** E.164 phone (e.g., "+15551234567") or JID (e.g., "15551234567@s.whatsapp.net"). Groups are not supported.

**Media:** Attach images, videos, or documents via mediaUrl. Type is auto-detected from extension (jpg/png=image, mp4=video, else=document).

**Example:**
- { to: "+15551234567", message: "Hello from Zee!" }
- { to: "+15551234567", message: "Check this out", mediaUrl: "/tmp/photo.jpg" }`,
    parameters: WhatsAppParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { to, message, mediaUrl, mediaType } = args
      ctx.metadata({ title: `WhatsApp -> ${to}` })
      return await sendFromAccount({
        to,
        message,
        account: "zee",
        mediaUrl,
        mediaType: mediaType as "image" | "video" | "document" | undefined,
      })
    },
  }),
}

export const personalWhatsAppTool: ToolDefinition = {
  id: "zee:whatsapp-personal",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via your personal WhatsApp number (wacli).

Alias for zee:whatsapp-zee -- both use the same wacli linked device session.

**Recipient lookup workflow (ALWAYS follow this):**
1. If the user says "message <name>" without a number, call zee:memory-query with mode "filter", domain "contacts" and the person's name as query.
2. If no results, try zee:memory-query with mode "search" and the person's name as query.
3. Only ask the user for a phone number if both searches return nothing.
4. Then call this tool with the resolved \`to\` value.

**Recipient format:** E.164 phone or JID. Groups are not supported.

**Example:**
- { to: "+15551234567", message: "Hi, it's me (Artur)" }`,
    parameters: WhatsAppParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { to, message, mediaUrl, mediaType } = args
      ctx.metadata({ title: `WhatsApp (Personal) -> ${to}` })
      return await sendFromAccount({
        to,
        message,
        account: "personal",
        mediaUrl,
        mediaType: mediaType as "image" | "video" | "document" | undefined,
      })
    },
  }),
}

// =============================================================================
// Generic WhatsApp with Explicit Account
// =============================================================================

const WhatsAppAccountParams = z.object({
  to: z.string().describe("Recipient phone number or JID"),
  message: z.string().describe("Message content to send"),
  account: z.string().default("zee").describe("WhatsApp account ID (default: 'zee')"),
  mediaUrl: z.string().optional()
    .describe("URL or local path to media file"),
  mediaType: z.enum(["image", "video", "document"]).optional()
    .describe("Media type (auto-detected from extension if omitted)"),
})

export const whatsAppAccountTool: ToolDefinition = {
  id: "zee:whatsapp-account",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via wacli (personal WhatsApp bridge).

All accounts currently use the same wacli linked device session.

**Account IDs:**
- "zee": Default (same as personal)
- "personal": Your personal WhatsApp number

**Recipient format:** E.164 phone or JID. Groups are not supported.

**Examples:**
- { to: "+15551234567", message: "Hello!", account: "zee" }`,
    parameters: WhatsAppAccountParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { to, message, account, mediaUrl, mediaType } = args
      ctx.metadata({ title: `WhatsApp (${account}) -> ${to}` })
      return await sendFromAccount({
        to,
        message,
        account,
        mediaUrl,
        mediaType: mediaType as "image" | "video" | "document" | undefined,
      })
    },
  }),
}

// Export all WhatsApp tools
export const WHATSAPP_TOOLS = [zeeWhatsAppTool, personalWhatsAppTool, whatsAppAccountTool]
