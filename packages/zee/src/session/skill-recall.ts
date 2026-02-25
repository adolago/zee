import { ConfigMarkdown } from "@/config/markdown"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Skill } from "@/skill/skill"
import { Log } from "@/util/log"
import { isShortAffirmativeReply } from "./followup-execution"

const log = Log.create({ service: "session.skill-recall" })

const MAX_QUERY_CHARS = 2000
const MAX_RECOMMENDATIONS = 3
const AUTOLOAD_SCORE_THRESHOLD = 12
const AUTOLOAD_MAX_CHARS = 3000

function extractUserText(msg: MessageV2.WithParts): string {
  return msg.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

type NearbyQueryContext = {
  latest: string
  previousUser?: string
  nearbyAssistant?: string
}

type ResolvedSkillRecallQuery = NearbyQueryContext & {
  query: string
  affirmativeFollowup: boolean
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

function resolveSkillRecallQuery(messages: MessageV2.WithParts[]): ResolvedSkillRecallQuery {
  const { latest, previousUser, nearbyAssistant } = latestQueryContext(messages)
  if (!latest) {
    return {
      latest,
      previousUser,
      nearbyAssistant,
      query: "",
      affirmativeFollowup: false,
    }
  }

  if (!previousUser && !nearbyAssistant) {
    return {
      latest,
      previousUser,
      nearbyAssistant,
      query: latest,
      affirmativeFollowup: false,
    }
  }

  if (isShortAffirmativeReply(latest)) {
    const parts: string[] = []
    if (previousUser) {
      parts.push(previousUser)
    }
    if (nearbyAssistant) {
      parts.push(`Assistant context: ${nearbyAssistant}`)
    }
    parts.push(`Follow-up confirmation: ${latest}`)
    return {
      latest,
      previousUser,
      nearbyAssistant,
      query: parts.join("\n\n").slice(0, MAX_QUERY_CHARS),
      affirmativeFollowup: true,
    }
  }

  return {
    latest,
    previousUser,
    nearbyAssistant,
    query: latest,
    affirmativeFollowup: false,
  }
}

export async function buildSkillRecallContext(input: {
  agent: Agent.Info
  messages: MessageV2.WithParts[]
}): Promise<string | undefined> {
  const followupHintLines = [
    "## Follow-Up Execution Hint",
    "The latest user message is a short confirmation to a pending action.",
    "Treat it as approval for the previously discussed action and continue execution now.",
    "Use available tools to execute first; do not ask for the same confirmation again.",
    "If mode restrictions block execution, ask for a mode switch instead of claiming integration unavailability.",
    "Only report integration unavailability after an actual tool call fails with connectivity/auth evidence.",
  ]

  const resolvedQuery = resolveSkillRecallQuery(input.messages)
  const query = resolvedQuery.query
  if (!query) return

  const recommendations = await Skill.recommend(query, input.agent.name, {
    limit: MAX_RECOMMENDATIONS,
    permission: input.agent.permission,
  })

  if (recommendations.length === 0) {
    if (!resolvedQuery.affirmativeFollowup) return
    return followupHintLines.join("\n")
  }

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
  if (top) {
    lines.push(
      "",
      `Primary execution path: load skill "${top.name}" first, then execute using that skill's workflow.`,
    )
  }

  if (resolvedQuery.affirmativeFollowup) {
    lines.push("", ...followupHintLines)
  }

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
