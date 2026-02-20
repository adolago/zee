import type { MessageV2 } from "./message-v2"

export type ExecutionMode = "plan" | "accept" | "bypass"

const SHORT_AFFIRMATIVE_REPLIES = new Set([
  "y",
  "yes",
  "yes please",
  "yep",
  "yeah",
  "sure",
  "ok",
  "okay",
  "go ahead",
  "do it",
  "please do",
  "please proceed",
  "proceed",
  "confirmed",
  "confirm",
  "sounds good",
  "works",
  "turn them off",
  "turn it off",
])

const CONFIRMATION_CUE = /\b(quick confirmation|confirm(?:ation)?|if yes|reply with|should i|before i (?:trigger|run|execute|do)|want me to)\b/i
const ACTION_CUE = /\b(turn|switch|set|run|execute|trigger|send|start|stop|open|close|lock|unlock|enable|disable|schedule|call|message|email)\b/i

function extractPrimaryText(message: MessageV2.WithParts): string {
  return message.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .filter((part) => !part.synthetic)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

function normalizeShortReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function isShortAffirmativeReply(text: string): boolean {
  if (!text) return false
  const normalized = normalizeShortReply(text)
  if (!normalized) return false
  if (normalized.length > 40) return false
  if (SHORT_AFFIRMATIVE_REPLIES.has(normalized)) return true
  return /^(yes|yep|yeah|sure|ok|okay)\b/.test(normalized)
}

export function buildFollowupExecutionReminder(input: {
  messages: MessageV2.WithParts[]
  mode: ExecutionMode
  surface?: string
}): string | undefined {
  let latestUser: { index: number; text: string } | undefined
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const msg = input.messages[i]
    if (msg.info.role !== "user") continue
    const text = extractPrimaryText(msg)
    if (!text) continue
    latestUser = { index: i, text }
    break
  }

  if (!latestUser || !isShortAffirmativeReply(latestUser.text)) return

  let previousAssistantText = ""
  for (let i = latestUser.index - 1; i >= 0; i--) {
    const msg = input.messages[i]
    if (msg.info.role !== "assistant") continue
    const text = extractPrimaryText(msg)
    if (!text) continue
    previousAssistantText = text
    break
  }

  if (!previousAssistantText) return
  if (!CONFIRMATION_CUE.test(previousAssistantText) || !ACTION_CUE.test(previousAssistantText)) return

  const previousContext = previousAssistantText.replace(/\s+/g, " ").trim().slice(0, 320)
  const planModeLine =
    input.surface === "whatsapp"
      ? "If PLAN mode blocks this action, ask for operator release with `/release <PIN>` before executing instead of claiming the integration is unavailable."
      : "If PLAN mode blocks this action, ask the user to switch to ACCEPT mode before executing instead of claiming the integration is unavailable."

  return [
    "<system-reminder>",
    "[FOLLOW-UP EXECUTION]",
    "The latest user message is a short confirmation of a pending action.",
    `Prior assistant action context: ${previousContext}`,
    "Treat this as approval and execute the pending action now using available tools.",
    "Do not ask for the same confirmation again.",
    input.mode === "plan"
      ? planModeLine
      : "Only claim integration unavailability after an actual tool call fails with connectivity or auth evidence.",
    "</system-reminder>",
  ].join("\n")
}
