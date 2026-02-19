import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { ConfigMarkdown } from "../config/markdown"
import { PermissionNext } from "../permission/next"

interface SkillMetadata {
  name?: string
  dir?: string
  query?: string
  count?: number
}

export const SkillTool = Tool.define<any, SkillMetadata>("skill", async (ctx) => {
  const agent = ctx?.agent
  const skills = await Skill.all(agent?.name)

  // Further filter by agent permissions if agent provided
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        return rule.action !== "deny"
      })
    : skills

  // Build compact grouped listing
  const description = buildCompactDescription(accessibleSkills)

  const parameters = z.object({
    name: z.string().optional().describe("Exact skill name to load"),
    query: z.string().optional().describe("Search skills by keyword"),
  })

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      // Load a specific skill by name
      if (params.name) {
        const skill = await Skill.get(params.name)

        if (!skill) {
          const skills = await Skill.all(ctx.agent)
          const available = skills.map((s) => s.name).join(", ")
          throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
        }

        const readiness = await Skill.readiness(skill, agent?.permission)
        if (readiness.permission === "deny") {
          throw new Error(`Skill "${skill.name}" is blocked by the current permission policy.`)
        }

        const dependencyReasons = readiness.blockedReasons.filter((reason) => !reason.startsWith("permission denied"))
        if (dependencyReasons.length > 0) {
          const lines = dependencyReasons.map((reason) => `- ${reason}`).join("\n")
          throw new Error(
            `Skill "${skill.name}" is installed but not ready:\n${lines}\n\nInstall/configure the missing dependencies and retry.`,
          )
        }

        await ctx.ask({
          permission: "skill",
          patterns: [skill.name],
          always: [skill.name],
          metadata: {},
        })
        const content = (await ConfigMarkdown.parse(skill.location)).content
        const dir = path.dirname(skill.location)

        const output = [`## Skill: ${skill.name}`, "", `**Base directory**: ${dir}`, "", content.trim()].join("\n")

        const userQuery = extractLatestUserText(ctx.messages)
        if (userQuery) {
          await Skill.recordUsage({
            query: userQuery,
            skill: skill.name,
            outcome: "success",
          }).catch(() => {})
        }

        return {
          title: `Loaded skill: ${skill.name}`,
          output,
          metadata: {
            name: skill.name,
            dir,
          },
        }
      }

      // Search skills by keyword
      if (params.query) {
        const results = await Skill.search(params.query, ctx.agent)
        const maxResults = 10

        if (results.length === 0) {
          return {
            title: `No skills matching "${params.query}"`,
            output: `No skills found for "${params.query}". Try a different keyword or use without parameters to see all skills.`,
            metadata: { query: params.query, count: 0 },
          }
        }

        const shown = results.slice(0, maxResults)
        const lines = shown.map((s) => {
          const crossTag = s.affinity === "cross" ? ` [via @${s.context}]` : ""
          return `- **${s.name}**: ${s.description}${crossTag}`
        })
        if (results.length > maxResults) {
          lines.push(`\n...and ${results.length - maxResults} more. Refine your search to narrow results.`)
        }
        lines.push("", 'Load with { name: "skill-name" } to get full instructions.')

        return {
          title: `Found ${results.length} skill(s) for "${params.query}"`,
          output: lines.join("\n"),
          metadata: { query: params.query, count: results.length },
        }
      }

      // Neither name nor query provided
      throw new Error('Provide { name: "skill-name" } to load a skill, or { query: "keyword" } to search.')
    },
  }
})

/**
 * Build a compact description that groups skills by affinity.
 * Saves ~650 tokens compared to verbose XML listing.
 */
function buildCompactDescription(skills: Skill.AnnotatedInfo[]): string {
  if (skills.length === 0) {
    return "Load a skill to get detailed instructions for a specific task. No skills are currently available."
  }

  const own = skills.filter((s) => s.affinity === "own")
  const shared = skills.filter((s) => s.affinity === "shared")
  const cross = skills.filter((s) => s.affinity === "cross")

  const lines: string[] = [
    "Load a skill for detailed instructions on a specific task.",
    'Search with { query: "keyword" } to find skills by name, tag, or trigger phrase.',
    'Load with { name: "skill-name" } to get full instructions.',
    "",
    "Skills by persona:",
  ]

  const summarize = (skill: Skill.AnnotatedInfo) => {
    const desc = skill.description.length > 80 ? skill.description.slice(0, 77) + "..." : skill.description
    return `${skill.name} (${desc})`
  }

  if (own.length > 0) {
    lines.push(`  yours: ${own.map((s) => summarize(s)).join("; ")}`)
  }
  if (shared.length > 0) {
    lines.push(`  shared: ${shared.map((s) => summarize(s)).join("; ")}`)
  }
  if (cross.length > 0) {
    // Group cross-persona skills by context
    const byContext = new Map<string, string[]>()
    for (const s of cross) {
      const ctx = s.context ?? "other"
      if (!byContext.has(ctx)) byContext.set(ctx, [])
      byContext.get(ctx)!.push(summarize(s))
    }
    for (const [persona, names] of byContext) {
      lines.push(`  @${persona}: ${names.join("; ")}`)
    }
  }

  return lines.join("\n")
}

function extractLatestUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return ""

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any
    if (msg?.info?.role !== "user" || !Array.isArray(msg?.parts)) continue

    const text = msg.parts
      .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
      .map((part: any) => part.text.trim())
      .filter(Boolean)
      .join("\n")
      .trim()

    if (text) return text
  }

  return ""
}
