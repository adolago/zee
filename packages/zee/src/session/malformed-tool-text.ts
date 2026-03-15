import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"

export const MALFORMED_TOOL_TEXT_FINISH = "malformed-tool-text"
export const MAX_MALFORMED_TOOL_TEXT_RECOVERIES = 1

const STRONG_PSEUDO_TOOL_LINE_PATTERNS = [
  /^\s*to=[a-z0-9_-]+\b/i,
  /^\s*<assistant\s+recipient=/i,
  /^\s*<\/assistant>\s*$/i,
  /^\s*<tool\b/i,
  /^\s*<\/tool>\s*$/i,
]

const JSON_ARGUMENT_LINE = /^\s*\{[\s\S]*\}\s*$/
const LITERAL_REQUEST_CUE = /\b(show|explain|example|syntax|format|literal|verbatim|meaning|what does|what is)\b/i
const TOOL_SYNTAX_REFERENCE = /to=|recipient=|<assistant|<tool|tool syntax|pseudo-tool|xml/i

export function isMalformedToolTextRecoveryEligibleModel(model: Provider.Model): boolean {
  const id = `${model.providerID}/${model.id}`.toLowerCase()
  return model.providerID === "openai" && id.includes("gpt-5")
}

export function extractVisibleText(parts: MessageV2.Part[]): string {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .filter((part) => !part.synthetic && !part.ignored)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

export function isLiteralToolSyntaxRequest(text: string): boolean {
  return LITERAL_REQUEST_CUE.test(text) && TOOL_SYNTAX_REFERENCE.test(text)
}

export function detectMalformedToolText(input: {
  parts: MessageV2.Part[]
  userText: string
  model: Provider.Model
}): { matched: boolean; reason?: string; excerpt?: string } {
  if (!isMalformedToolTextRecoveryEligibleModel(input.model)) return { matched: false }
  if (input.parts.some((part) => part.type === "tool")) return { matched: false }
  if (isLiteralToolSyntaxRequest(input.userText)) return { matched: false }

  const text = extractVisibleText(input.parts)
  if (!text) return { matched: false }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  let strongSignals = 0
  let jsonSignals = 0
  const excerpt: string[] = []

  for (const line of lines) {
    if (STRONG_PSEUDO_TOOL_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      strongSignals++
      if (excerpt.length < 3) excerpt.push(line)
      continue
    }
    if (JSON_ARGUMENT_LINE.test(line)) {
      jsonSignals++
      if (excerpt.length < 3) excerpt.push(line)
    }
  }

  const hasInlineDirective = /(?:^|\n)\s*to=[a-z0-9_-]+\b[^\n]*$/im.test(text)
  const hasAssistantTagPair = /<assistant\s+recipient=/i.test(text) && /<\/assistant>/i.test(text)
  const hasToolTag = /<tool\b/i.test(text)
  const matched =
    strongSignals >= 2 ||
    (strongSignals >= 1 && jsonSignals >= 1) ||
    hasInlineDirective ||
    hasAssistantTagPair ||
    hasToolTag

  if (!matched) return { matched: false }

  return {
    matched: true,
    reason: `strong=${strongSignals} json=${jsonSignals} inline=${hasInlineDirective} assistantTag=${hasAssistantTagPair} toolTag=${hasToolTag}`,
    excerpt: excerpt.join(" | ").slice(0, 240),
  }
}

export function buildMalformedToolTextRetryReminder(input: { messages: MessageV2.WithParts[] }): string | undefined {
  const latestUser = input.messages.findLast(
    (msg): msg is MessageV2.WithParts & { info: MessageV2.User } => msg.info.role === "user",
  )
  const latestAssistant = input.messages.findLast(
    (msg): msg is MessageV2.WithParts & { info: MessageV2.Assistant } => msg.info.role === "assistant",
  )
  if (!latestUser || !latestAssistant) return
  if (latestAssistant.info.parentID !== latestUser.info.id) return
  if (latestAssistant.info.finish !== MALFORMED_TOOL_TEXT_FINISH) return

  return [
    "<system-reminder>",
    "[MALFORMED TOOL OUTPUT]",
    "The previous assistant turn printed pseudo-tool syntax as plain text instead of using native tool calls.",
    "Do not print tool-call syntax such as to=..., <assistant recipient=...>, <tool ...>, XML wrappers, or raw JSON arguments.",
    "Use actual tool calls when you need tools.",
    "Only claim tools, files, or integrations are unavailable after a real tool call fails.",
    "</system-reminder>",
  ].join("\n")
}
