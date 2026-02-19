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

function latestUserQuery(messages: MessageV2.WithParts[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue

    const text = msg.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n")
      .trim()

    if (!text) continue
    return text.slice(0, MAX_QUERY_CHARS)
  }
  return ""
}

export async function buildSkillRecallContext(input: {
  agent: Agent.Info
  messages: MessageV2.WithParts[]
}): Promise<string | undefined> {
  const query = latestUserQuery(input.messages)
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
