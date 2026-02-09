/**
 * WhatsApp Domain Tools
 *
 * Provides explicit control over multiple WhatsApp numbers:
 * - Zee's own number (dedicated bot line)
 * - Personal number (your own WhatsApp)
 * - Any other configured accounts
 */

import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types";
import { Log } from "../../../packages/zee-core/src/util/log";

const log = Log.create({ service: "zee-whatsapp" });

// Schema for gateway API responses
const GatewayResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

function resolveBaseUrl(): string {
  const rawBaseUrl =
    process.env.ZEE_URL ||
    process.env.ZEE_DAEMON_URL ||
    process.env.AGENT_CORE_URL ||
    process.env.AGENT_CORE_DAEMON_URL ||
    `http://127.0.0.1:${
      process.env.ZEE_PORT ||
      process.env.ZEE_DAEMON_PORT ||
      process.env.AGENT_CORE_PORT ||
      process.env.AGENT_CORE_DAEMON_PORT ||
      "3210"
    }`;
  return rawBaseUrl.replace(/\/$/, "");
}

// =============================================================================
// Send via Zee's Number (Dedicated Bot Line)
// =============================================================================

const ZeeWhatsAppParams = z.object({
  to: z.string().describe("Recipient phone number (E.164 format, e.g., +15551234567) or WhatsApp JID"),
  message: z.string().describe("Message content to send"),
});

export const zeeWhatsAppTool: ToolDefinition = {
  id: "zee:whatsapp-zee",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via Zee's dedicated bot number.

**Recipient lookup workflow (ALWAYS follow this):**
1. If the user says "message <name>" without a number, call zee:memory-agentic-search with domain "contacts" first to find their number/chatId.
2. If no memory result, try zee:memory-search with the person's name as query.
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
      const { to, message } = args;
      ctx.metadata({ title: `WhatsApp (Zee) → ${to}` });

      const baseUrl = resolveBaseUrl();

      try {
        const response = await fetch(`${baseUrl}/gateway/whatsapp/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: to, message, accountId: "zee" }),
        });

        const rawResult = await response.json();
        const parseResult = GatewayResponseSchema.safeParse(rawResult);

        if (!parseResult.success || !parseResult.data.success) {
          const error = parseResult.data?.error || "Unknown error";
          return {
            title: `WhatsApp Send Failed`,
            metadata: { to, error },
            output: `Failed to send from Zee's number: ${error}`,
          };
        }

        return {
          title: `Sent from Zee's WhatsApp`,
          metadata: { to, account: "zee", success: true },
          output: `Message sent from Zee's bot number to ${to}\n\nPreview: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: `WhatsApp Error`,
          metadata: { to, error: errorMsg },
          output: `Error sending from Zee's number: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Send via Personal Number (Your Own WhatsApp)
// =============================================================================

const PersonalWhatsAppParams = z.object({
  to: z.string().describe("Recipient phone number (E.164 format, e.g., +15551234567) or WhatsApp JID"),
  message: z.string().describe("Message content to send"),
});

export const personalWhatsAppTool: ToolDefinition = {
  id: "zee:whatsapp-personal",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via YOUR personal WhatsApp number.

**Recipient lookup workflow (ALWAYS follow this):**
1. If the user says "message <name>" without a number, call zee:memory-agentic-search with domain "contacts" first to find their number/chatId.
2. If no memory result, try zee:memory-search with the person's name as query.
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
      const { to, message } = args;
      ctx.metadata({ title: `WhatsApp (Personal) → ${to}` });

      const baseUrl = resolveBaseUrl();

      try {
        const response = await fetch(`${baseUrl}/gateway/whatsapp/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: to, message, accountId: "personal" }),
        });

        const rawResult = await response.json();
        const parseResult = GatewayResponseSchema.safeParse(rawResult);

        if (!parseResult.success || !parseResult.data.success) {
          const error = parseResult.data?.error || "Unknown error";
          return {
            title: `WhatsApp Send Failed`,
            metadata: { to, error },
            output: `Failed to send from your personal number: ${error}\n\nMake sure:\n1. Your personal WhatsApp is configured (account: "personal")\n2. You've scanned the QR code to link your account\n3. The account is enabled in Zee config`,
          };
        }

        return {
          title: `Sent from Personal WhatsApp`,
          metadata: { to, account: "personal", success: true },
          output: `Message sent from YOUR personal number to ${to}\n\nPreview: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: `WhatsApp Error`,
          metadata: { to, error: errorMsg },
          output: `Error sending from personal number: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Generic WhatsApp with Explicit Account
// =============================================================================

const WhatsAppAccountParams = z.object({
  to: z.string().describe("Recipient phone number (E.164 format) or WhatsApp JID"),
  message: z.string().describe("Message content to send"),
  account: z.string().default("zee").describe("WhatsApp account ID to use (default: 'zee')"),
});

export const whatsAppAccountTool: ToolDefinition = {
  id: "zee:whatsapp-account",
  category: "domain",
  init: async () => ({
    description: `Send WhatsApp messages via any configured account.

**Account IDs:**
- "zee": Zee's dedicated bot number (default)
- "personal": Your personal WhatsApp number
- Any custom account ID you've configured

**Configuration in ~/.zee/zee.json:**
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
      const { to, message, account } = args;
      ctx.metadata({ title: `WhatsApp (${account}) → ${to}` });

      const baseUrl = resolveBaseUrl();

      try {
        const response = await fetch(`${baseUrl}/gateway/whatsapp/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: to, message, accountId: account }),
        });

        const rawResult = await response.json();
        const parseResult = GatewayResponseSchema.safeParse(rawResult);

        if (!parseResult.success || !parseResult.data.success) {
          const error = parseResult.data?.error || "Unknown error";
          return {
            title: `WhatsApp Send Failed`,
            metadata: { to, account, error },
            output: `Failed to send via account "${account}": ${error}`,
          };
        }

        const accountLabel = account === "zee" ? "Zee's number" : 
                            account === "personal" ? "your personal number" : 
                            `account "${account}"`;

        return {
          title: `Sent via WhatsApp (${account})`,
          metadata: { to, account, success: true },
          output: `Message sent via ${accountLabel} to ${to}\n\nPreview: "${message.substring(0, 100)}${message.length > 100 ? "..." : ""}"`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          title: `WhatsApp Error`,
          metadata: { to, account, error: errorMsg },
          output: `Error sending via account "${account}": ${errorMsg}`,
        };
      }
    },
  }),
};

// Export all WhatsApp tools
export const WHATSAPP_TOOLS = [zeeWhatsAppTool, personalWhatsAppTool, whatsAppAccountTool];
