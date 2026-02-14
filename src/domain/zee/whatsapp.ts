/**
 * WhatsApp Domain Tools
 *
 * Provides explicit control over multiple WhatsApp numbers:
 * - Zee's own number (dedicated bot line)
 * - Personal number (your own WhatsApp)
 * - Any other configured accounts
 */

import { z } from "zod"
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types"
import { sendWhatsAppMessage, type WhatsAppTransport } from "./whatsapp-send.js"

function buildTransportTroubleshooting(transport: "wacli" | "gateway"): string {
  if (transport === "wacli") {
    return `Troubleshooting:
1. Ensure \`~/go/bin/wacli\` is installed
2. If locked, stop \`wacli sync --follow\`
3. If unauthenticated, run \`~/go/bin/wacli auth\``
  }

  return `Troubleshooting:
1. Ensure \`zee daemon\` is running
2. Check \`zee debug status\` shows Gateway: Active
3. Verify recipient format (E164 like "+1555..." or JID like "1234567890@c.us")`
}

function previewText(message: string): string {
  return `${message.substring(0, 100)}${message.length > 100 ? "..." : ""}`
}

async function sendFromAccount(params: {
  to: string
  message: string
  account: string
  transport?: WhatsAppTransport
}): Promise<ToolExecutionResult> {
  const { to, message, account, transport } = params
  const result = await sendWhatsAppMessage({
    to,
    message,
    accountId: account,
    transport,
  })

  if (!result.success) {
    return {
      title: `WhatsApp Send Failed`,
      metadata: {
        to,
        account,
        transport: result.transport,
        error: result.error,
        errorCode: result.code,
      },
      output: `Failed to send via account "${account}": ${result.error}

${buildTransportTroubleshooting(result.transport)}`,
    }
  }

  const accountLabel = account === "zee"
    ? "Zee's bot number"
    : account === "personal"
      ? "your personal number"
      : `account "${account}"`

  return {
    title: `Sent via WhatsApp (${account})`,
    metadata: {
      to,
      account,
      success: true,
      transport: result.transport,
    },
    output: `Message sent via ${accountLabel} to ${to}

Transport: ${result.transport}
Preview: "${previewText(message)}"`,
  }
}

// =============================================================================
// Send via Zee's Number (Dedicated Bot Line)
// =============================================================================

const ZeeWhatsAppParams = z.object({
  to: z.string().describe("Recipient phone number (E.164 format, e.g., +15551234567) or WhatsApp JID"),
  message: z.string().describe("Message content to send"),
  transport: z.enum(["auto", "wacli", "gateway"]).optional()
    .describe("Transport strategy: auto (wacli first), wacli only, or gateway only"),
})

export const zeeWhatsAppTool: ToolDefinition = {
  id: "zee:whatsapp-zee",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via Zee's dedicated bot number.

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

**Recipient formats:**
- E.164 phone: "+15551234567"
- WhatsApp JID: "1234567890@c.us" (DM) or "1234567890@g.us" (group)

**Example:**
- { to: "+15551234567", message: "Hello from Zee!" }

See also: zee:whatsapp-personal for sending from your own number`,
    parameters: ZeeWhatsAppParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { to, message, transport } = args
      ctx.metadata({ title: `WhatsApp (Zee) → ${to}` })
      return await sendFromAccount({
        to,
        message,
        account: "zee",
        transport: (transport ?? "auto") as WhatsAppTransport,
      })
    },
  }),
}

// =============================================================================
// Send via Personal Number (Your Own WhatsApp)
// =============================================================================

const PersonalWhatsAppParams = z.object({
  to: z.string().describe("Recipient phone number (E.164 format, e.g., +15551234567) or WhatsApp JID"),
  message: z.string().describe("Message content to send"),
  transport: z.enum(["auto", "wacli", "gateway"]).optional()
    .describe("Transport strategy: auto (wacli first), wacli only, or gateway only"),
})

export const personalWhatsAppTool: ToolDefinition = {
  id: "zee:whatsapp-personal",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via YOUR personal WhatsApp number.

**Recipient lookup workflow (ALWAYS follow this):**
1. If the user says "message <name>" without a number, call zee:memory-query with mode "filter", domain "contacts" and the person's name as query.
2. If no results, try zee:memory-query with mode "search" and the person's name as query.
3. Only ask the user for a phone number if both searches return nothing.
4. Then call this tool with the resolved \`to\` value.

This uses your own WhatsApp number, not Zee's bot line.

**When to use:**
- When you specifically want to send as yourself
- Personal messaging
- When the recipient knows your personal number

**Prerequisites:**
- Your personal WhatsApp must be configured in Zee gateway
- You must have scanned the QR code to link your account

**Recipient formats:**
- E.164 phone: "+15551234567"
- WhatsApp JID: "1234567890@c.us" (DM) or "1234567890@g.us" (group)

**Example:**
- { to: "+15551234567", message: "Hi, it's me (Artur)" }

See also: zee:whatsapp-zee for sending from Zee's dedicated number`,
    parameters: PersonalWhatsAppParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { to, message, transport } = args
      ctx.metadata({ title: `WhatsApp (Personal) → ${to}` })
      return await sendFromAccount({
        to,
        message,
        account: "personal",
        transport: (transport ?? "auto") as WhatsAppTransport,
      })
    },
  }),
}

// =============================================================================
// Generic WhatsApp with Explicit Account
// =============================================================================

const WhatsAppAccountParams = z.object({
  to: z.string().describe("Recipient phone number (E.164 format) or WhatsApp JID"),
  message: z.string().describe("Message content to send"),
  account: z.string().default("zee").describe("WhatsApp account ID to use (default: 'zee')"),
  transport: z.enum(["auto", "wacli", "gateway"]).optional()
    .describe("Transport strategy: auto (wacli first), wacli only, or gateway only"),
})

export const whatsAppAccountTool: ToolDefinition = {
  id: "zee:whatsapp-account",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via any configured account.

**Account IDs:**
- "zee": Zee's dedicated bot number (default)
- "personal": Your personal WhatsApp number
- Any custom account ID you've configured

**Configuration in ~/.config/zee/zee.jsonc:**
{
  "channels": {
    "whatsapp": {
      "accounts": {
        "zee": { "enabled": true, "name": "Zee Bot" },
        "personal": { "enabled": true, "name": "My Number", "selfChatMode": true }
      }
    }
  }
}

**Examples:**
- Via Zee: { to: "+15551234567", message: "Hello!", account: "zee" }
- Via personal: { to: "+15551234567", message: "Hello!", account: "personal" }
- Via custom: { to: "+15551234567", message: "Hello!", account: "work" }`,
    parameters: WhatsAppAccountParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { to, message, account, transport } = args
      ctx.metadata({ title: `WhatsApp (${account}) → ${to}` })
      return await sendFromAccount({
        to,
        message,
        account,
        transport: (transport ?? "auto") as WhatsAppTransport,
      })
    },
  }),
}

// Export all WhatsApp tools
export const WHATSAPP_TOOLS = [zeeWhatsAppTool, personalWhatsAppTool, whatsAppAccountTool]
