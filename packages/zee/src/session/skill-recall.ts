import { ConfigMarkdown } from "@/config/markdown"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Skill } from "@/skill/skill"
import { Log } from "@/util/log"

const log = Log.create({ service: "session.skill-recall" })

const MAX_QUERY_CHARS = 2000
const MAX_RECOMMENDATIONS = 3
const AUTOLOAD_SCORE_THRESHOLD = 12
const AUTOLOAD_MAX_CHARS = 3000

const AFFIRMATIVE_FOLLOWUPS = new Set([
  "y",
  "yes",
  "yes.",
  "yes!",
  "yes please",
  "yep",
  "yeah",
  "sure",
  "ok",
  "okay",
  "ok thanks",
  "okay thanks",
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

function extractUserText(msg: MessageV2.WithParts): string {
  return msg.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

function normalizeFollowup(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isAffirmativeFollowup(text: string): boolean {
  if (!text) return false
  const normalized = normalizeFollowup(text)
  if (!normalized) return false
  if (normalized.length > 40) return false
  if (AFFIRMATIVE_FOLLOWUPS.has(normalized)) return true
  return /^(yes|yep|yeah|sure|ok|okay)\b/.test(normalized)
}

type NearbyQueryContext = {
  latest: string
  previousUser?: string
  nearbyAssistant?: string
}

function latestQueryContext(messages: MessageV2.WithParts[]): NearbyQueryContext {
  let latestUser: { index: number; text: string } | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    const text = extractUserText(msg)
    if (!text) continue
    latestUser = { index: i, text: text.slice(0, MAX_QUERY_CHARS) }
    break
  }

  if (!latestUser) return { latest: "" }

  let previousUser: { index: number; text: string } | undefined
  for (let i = latestUser.index - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    const text = extractUserText(msg)
    if (!text) continue
    previousUser = { index: i, text: text.slice(0, MAX_QUERY_CHARS) }
    break
  }

  let nearbyAssistant: string | undefined
  for (let i = latestUser.index - 1; i >= 0; i--) {
    if (previousUser && i <= previousUser.index) break
    const msg = messages[i]
    if (msg.info.role !== "assistant") continue
    const text = extractUserText(msg)
    if (!text) continue
    nearbyAssistant = text.slice(0, 500)
    break
  }

  return {
    latest: latestUser.text,
    previousUser: previousUser?.text,
    nearbyAssistant,
  }
}

function resolveSkillRecallQuery(messages: MessageV2.WithParts[]): string {
  const { latest, previousUser, nearbyAssistant } = latestQueryContext(messages)
  if (!latest) return ""
  if (!previousUser && !nearbyAssistant) return latest

  if (isAffirmativeFollowup(latest)) {
    const parts: string[] = []
    if (previousUser) {
      parts.push(previousUser)
    }
    if (nearbyAssistant) {
      parts.push(`Assistant context: ${nearbyAssistant}`)
    }
    parts.push(`Follow-up confirmation: ${latest}`)
    return parts.join("\n\n").slice(0, MAX_QUERY_CHARS)
  }

  return latest
}

export async function buildSkillRecallContext(input: {
  agent: Agent.Info
  messages: MessageV2.WithParts[]
}): Promise<string | undefined> {
  const query = resolveSkillRecallQuery(input.messages)
  if (!query) return

  const recommendations = await Skill.recommend(query, input.agent.name, {
    limit: MAX_RECOMMENDATIONS,
    permission: input.agent.permission,
  })

  if (recommendations.length === 0) return

  const lines: string[] = [
    "## Recommended Skills For This Turn",
    "Before claiming a capability is unavailable, check these skills first.",
    "",
  ]

  for (const recommendation of recommendations) {
    const score = recommendation.score.toFixed(1)
    lines.push(`- ${recommendation.name} (score ${score}): ${recommendation.reason}`)
  }

  const top = recommendations[0]
  if (top && top.score >= AUTOLOAD_SCORE_THRESHOLD) {
    try {
      const md = await ConfigMarkdown.parse(top.location)
      const content = md.content.trim()
      if (content) {
        lines.push("", `### Auto-loaded Skill: ${top.name}`)
        if (content.length > AUTOLOAD_MAX_CHARS) {
          lines.push(content.slice(0, AUTOLOAD_MAX_CHARS) + "\n...(truncated)")
        } else {
          lines.push(content)
        }
      }
    } catch (error) {
      log.debug("failed to auto-load recommended skill content", {
        skill: top.name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return lines.join("\n")
}
