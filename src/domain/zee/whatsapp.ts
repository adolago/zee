/**
 * WhatsApp Domain Tools
 *
 * Provides WhatsApp messaging via the Business API (meta-cli).
 * All tools send from the same Business API number.
 * Tools are kept as separate surfaces for API compatibility.
 */

import { z } from "zod"
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types"
import { sendWhatsAppMessage, type MetaCliSendErrorCode } from "./whatsapp-send.js"

function buildMetaCliTroubleshooting(code: MetaCliSendErrorCode): string {
  switch (code) {
    case "META_CLI_NOT_FOUND":
      return `Troubleshooting:
1. Install meta-cli: \`bun add -g @anthropic/meta-cli\`
2. Or set ZEE_META_CLI_BIN to the binary path
3. Verify: \`meta doctor\``
    case "META_CLI_TIMEOUT":
      return `Troubleshooting:
1. Check network connectivity
2. Verify Business API status: \`meta doctor\`
3. Try again with a longer timeoutMs`
    case "META_CLI_AUTH_FAILED":
      return `Troubleshooting:
1. Run \`meta auth login\` to re-authenticate
2. Verify token: \`meta doctor\`
3. Check token expiration in Meta Business Suite`
    case "META_CLI_API_ERROR":
      return `Troubleshooting:
1. Verify recipient number is on WhatsApp
2. Check message template compliance (24h window)
3. Run \`meta doctor\` for API status`
    case "META_CLI_FAILED":
      return `Troubleshooting:
1. Run \`meta doctor\` to check configuration
2. Verify \`meta wa send\` works manually
3. Check meta-cli logs for details`
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
      output: `Failed to send via account "${account}": ${result.error}

${buildMetaCliTroubleshooting(result.code)}`,
    }
  }

  const accountLabel = account === "zee"
    ? "Zee's bot number"
    : account === "personal"
      ? "your personal number"
      : `account "${account}"`

  const mediaLabel = mediaUrl ? " with media" : ""

  return {
    title: `Sent via WhatsApp (${account})`,
    metadata: {
      to,
      account,
      success: true,
      messageId: result.messageId,
      waId: result.waId,
    },
    output: `Message sent via ${accountLabel} to ${to}${mediaLabel}

Preview: "${previewText(message)}"${result.messageId ? `\nMessage ID: ${result.messageId}` : ""}`,
  }
}

// =============================================================================
// Send via Zee's Number (Dedicated Bot Line)
// =============================================================================

const ZeeWhatsAppParams = z.object({
  to: z.string().describe("Recipient phone number in E.164 format (e.g., +15551234567)"),
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
    description: `Send WhatsApp messages via Zee's dedicated bot number (Business API).

**Recipient lookup workflow (ALWAYS follow this):**
1. If the user says "message <name>" without a number, call zee:memory-query with mode "filter", domain "contacts" and the person's name as query.
2. If no results, try zee:memory-query with mode "search" and the person's name as query.
3. Only ask the user for a phone number if both searches return nothing.
4. Then call this tool with the resolved \`to\` value.

This uses Zee's own WhatsApp number (the bot line), not your personal number.

**When to use:**
- Default messaging from Zee
- Automated notifications
- Responses to users who messaged Zee's number

**Recipient format:** E.164 phone only (e.g., "+15551234567"). JID suffixes are stripped automatically. Groups are not supported.

**Media:** Attach images, videos, or documents via mediaUrl. Type is auto-detected from extension (jpg/png=image, mp4=video, else=document).

**Example:**
- { to: "+15551234567", message: "Hello from Zee!" }
- { to: "+15551234567", message: "Check this out", mediaUrl: "/tmp/photo.jpg" }

See also: zee:whatsapp-personal for sending from your own number`,
    parameters: ZeeWhatsAppParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { to, message, mediaUrl, mediaType } = args
      ctx.metadata({ title: `WhatsApp (Zee) → ${to}` })
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

// =============================================================================
// Send via Personal Number (Your Own WhatsApp)
// =============================================================================

const PersonalWhatsAppParams = z.object({
  to: z.string().describe("Recipient phone number in E.164 format (e.g., +15551234567)"),
  message: z.string().describe("Message content to send"),
  mediaUrl: z.string().optional()
    .describe("URL or local path to media file (image, video, document)"),
  mediaType: z.enum(["image", "video", "document"]).optional()
    .describe("Media type (auto-detected from extension if omitted)"),
})

export const personalWhatsAppTool: ToolDefinition = {
  id: "zee:whatsapp-personal",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via YOUR personal WhatsApp number (Business API).

**Recipient lookup workflow (ALWAYS follow this):**
1. If the user says "message <name>" without a number, call zee:memory-query with mode "filter", domain "contacts" and the person's name as query.
2. If no results, try zee:memory-query with mode "search" and the person's name as query.
3. Only ask the user for a phone number if both searches return nothing.
4. Then call this tool with the resolved \`to\` value.

Note: All tools currently send from the same Business API number. This tool is kept for API compatibility.

**When to use:**
- When you specifically want to send as yourself
- Personal messaging

**Recipient format:** E.164 phone only (e.g., "+15551234567"). Groups are not supported.

**Media:** Attach images, videos, or documents via mediaUrl. Type is auto-detected from extension.

**Example:**
- { to: "+15551234567", message: "Hi, it's me (Artur)" }

See also: zee:whatsapp-zee for sending from Zee's dedicated number`,
    parameters: PersonalWhatsAppParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { to, message, mediaUrl, mediaType } = args
      ctx.metadata({ title: `WhatsApp (Personal) → ${to}` })
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
  to: z.string().describe("Recipient phone number in E.164 format"),
  message: z.string().describe("Message content to send"),
  account: z.string().default("zee").describe("WhatsApp account ID to use (default: 'zee')"),
  mediaUrl: z.string().optional()
    .describe("URL or local path to media file"),
  mediaType: z.enum(["image", "video", "document"]).optional()
    .describe("Media type (auto-detected from extension if omitted)"),
})

export const whatsAppAccountTool: ToolDefinition = {
  id: "zee:whatsapp-account",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via any configured account (Business API).

Note: All accounts currently use the same Business API number. Account selection is kept for API compatibility.

**Account IDs:**
- "zee": Zee's dedicated bot number (default)
- "personal": Your personal WhatsApp number

**Recipient format:** E.164 phone only (e.g., "+15551234567"). Groups are not supported.

**Examples:**
- Via Zee: { to: "+15551234567", message: "Hello!", account: "zee" }
- Via personal: { to: "+15551234567", message: "Hello!", account: "personal" }`,
    parameters: WhatsAppAccountParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { to, message, account, mediaUrl, mediaType } = args
      ctx.metadata({ title: `WhatsApp (${account}) → ${to}` })
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
