import type { MessageV2 } from "./message-v2"
import type { ExecutionMode } from "./followup-execution"

const WEB_INTENT_CUE =
  /\b(web|internet|online|website|site|url|link|browser|search|look up|lookup|google|wikipedia|reddit|youtube|navigate|browse|visit|fetch|scrape)\b/i

const WEB_MUTATION_CUE =
  /\b(submit|checkout|purchase|buy|order|book|reserve|post|publish|tweet|upload|transfer|pay|wire|fill\s+out\s+(?:the\s+)?form|log\s?in|sign\s?in|register|create\s+account|change\s+password|update\s+profile|delete\s+account|account\s+settings?)\b/i

function extractPrimaryText(message: MessageV2.WithParts): string {
  return message.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .filter((part) => !part.synthetic)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

function latestUserText(messages: MessageV2.WithParts[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    const text = extractPrimaryText(msg)
    if (text) return text
  }
  return ""
}

function isWebIntent(text: string): boolean {
  if (!text) return false
  if (/https?:\/\//i.test(text)) return true
  return WEB_INTENT_CUE.test(text)
}

function isWebMutationIntent(text: string): boolean {
  if (!text) return false
  return WEB_MUTATION_CUE.test(text)
}

export function buildPlanWebExecutionReminder(input: {
  messages: MessageV2.WithParts[]
  mode: ExecutionMode
  surface?: string
}): string | undefined {
  if (input.mode !== "plan") return

  const text = latestUserText(input.messages)
  if (!isWebIntent(text)) return

  const mutating = isWebMutationIntent(text)
  const modeSwitchLine =
    input.surface === "whatsapp" || input.surface === "telegram"
      ? "If a mutating web action is required, ask the user to switch to ACCEPT mode (for example `/accept <PIN>` when required) before executing."
      : "If a mutating web action is required, ask the user to switch to ACCEPT mode before executing."

  return [
    "<system-reminder>",
    "[PLAN WEB EXECUTION]",
    "The latest user message requests internet/web work.",
    "Execute read-only web actions now using available tools (websearch, webfetch, and read-only browser actions such as navigate/snapshot/screenshot/tabs).",
    "Do not reply with only instructions when a read-only web action can be executed directly.",
    mutating
      ? "The request appears to include a mutating web action. Do not execute mutating web actions in PLAN mode (form submissions, purchases, posting content, account/settings changes, or other external state changes)."
      : "Do not perform mutating web actions in PLAN mode (form submissions, purchases, posting content, account/settings changes, or other external state changes).",
    modeSwitchLine,
    "</system-reminder>",
  ].join("\n")
}
