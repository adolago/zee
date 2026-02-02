/**
 * Zee Messaging Tool - Plugin wrapper for cross-platform messaging
 *
 * Wraps the Zee messaging tool in the plugin format.
 */

import { tool } from "@agent-core/plugin"

export default tool({
  description: `Send messages via WhatsApp or Telegram gateways.

Channels:
- **whatsapp**: Zee's WhatsApp gateway (requires agent-core daemon with gateway enabled)
- **telegram**: Telegram bots (requires agent-core daemon with gateway enabled)

WhatsApp:
- to: E164 phone (e.g., "+1555...") or chat JID (e.g., "1234567890@c.us" or "...@g.us")
- Only Zee can send via WhatsApp

Telegram:
- to: Chat ID (numeric) or @username
- persona: Which bot/account to use - "stanley" (default) or "johny"

Examples:
- WhatsApp: { channel: "whatsapp", to: "+15551234567", message: "Hello!" }
- Telegram via Stanley: { channel: "telegram", to: "123456789", message: "Market update!", persona: "stanley" }`,
  args: {
    channel: tool.schema
      .enum(["whatsapp", "telegram"])
      .describe("Messaging channel: whatsapp (Zee) or telegram (Stanley/Johny bots)"),
    to: tool.schema.string().describe("Recipient: WhatsApp chatId or Telegram chatId (numeric)"),
    message: tool.schema.string().describe("Message content"),
    persona: tool.schema
      .enum(["zee", "stanley", "johny"])
      .optional()
      .describe("For Telegram: which persona's bot to use (default: stanley)"),
  },
  async execute(args) {
    const { channel, to, message, persona } = args

    const rawBaseUrl =
      process.env.AGENT_CORE_URL ||
      process.env.AGENT_CORE_DAEMON_URL ||
      `http://127.0.0.1:${process.env.AGENT_CORE_PORT || "3210"}`
    const baseUrl = rawBaseUrl.replace(/\/$/, "")

    try {
      if (channel === "whatsapp") {
        // Send via WhatsApp gateway (Zee only)
        const response = await fetch(`${baseUrl}/gateway/whatsapp/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: to, message }),
        })

        if (!response.ok) {
          const error = await response.text()
          return `Failed to send WhatsApp message: ${error}

Troubleshooting:
- Ensure \`agent-core daemon\` is running
- Check \`agent-core debug status\` shows Gateway: Active
- Verify recipient format (E164 like "+1555..." or JID like "1234567890@c.us")`
        }

        const result = await response.json()
        if (!result.success) {
          return `Failed to send WhatsApp message: ${result.error || "Unknown error"}`
        }

        return `Message sent via WhatsApp to ${to}

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
- Ensure \`agent-core daemon\` is running
- Check \`agent-core debug status\` shows Gateway: Active
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
- Ensure agent-core daemon is running
- Check gateway status with /status command
- Verify network connectivity`
    }
  },
})
