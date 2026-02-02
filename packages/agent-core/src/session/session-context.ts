import fs from "fs/promises"
import path from "path"
import os from "os"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Skill } from "@/skill/skill"
import { ConfigMarkdown } from "@/config/markdown"

const log = Log.create({ service: "session.context" })

const CONTEXT_SECTION_MAX_CHARS = 8000
const SKILL_SECTION_MAX_CHARS = 8000
const MIN_TRUNCATE_CHARS = 500

export type SessionContextInput = {
  systemPrompt?: string
  skills?: string[]
  contextFiles?: string[]
}

export async function buildSessionSystemContext(input: SessionContextInput): Promise<string[]> {
  const sections: string[] = []

  if (input.systemPrompt?.trim()) {
    sections.push(["## Session System Prompt", input.systemPrompt.trim()].join("\n"))
  }

  const skillSection = await loadSkillSection(input.skills)
  if (skillSection) sections.push(skillSection)

  const contextSection = await loadContextFilesSection(input.contextFiles)
  if (contextSection) sections.push(contextSection)

  return sections
}

async function loadSkillSection(skills?: string[]): Promise<string> {
  if (!skills || skills.length === 0) return ""

  const lines: string[] = ["## Session Skills", `Requested skills: ${skills.join(", ")}`, ""]
  let used = 0

  for (const skillName of skills) {
    const skill = await Skill.get(skillName)
    if (!skill) {
      log.debug("session skill not found", { skill: skillName })
      continue
    }

    let content = ""
    try {
      const md = await ConfigMarkdown.parse(skill.location)
      content = md.content.trim()
    } catch (error) {
      log.warn("failed to load session skill", { skill: skillName, error: String(error) })
      continue
    }

    const remaining = SKILL_SECTION_MAX_CHARS - used
    if (remaining <= 0) break

    lines.push(`### ${skill.name}`)
    if (content.length > remaining) {
      if (remaining > MIN_TRUNCATE_CHARS) {
        lines.push(content.slice(0, Math.max(0, remaining - 50)) + "\n...(truncated)")
      }
      used = SKILL_SECTION_MAX_CHARS
      break
    }

    lines.push(content)
    lines.push("")
    used += content.length
  }

  return lines.join("\n")
}

async function loadContextFilesSection(contextFiles?: string[]): Promise<string> {
  if (!contextFiles || contextFiles.length === 0) return ""

  const lines: string[] = ["## Session Context Files", `Requested files: ${contextFiles.join(", ")}`, ""]
  let used = 0

  for (const rawPath of contextFiles) {
    const resolved = resolvePath(rawPath)
    let stat
    try {
      stat = await fs.stat(resolved)
    } catch {
      continue
    }
    if (!stat.isFile()) continue

    let content: string
    try {
      content = (await fs.readFile(resolved, "utf-8")).trim()
    } catch (error) {
      log.debug("failed to load context file", { path: resolved, error: String(error) })
      continue
    }

    const remaining = CONTEXT_SECTION_MAX_CHARS - used
    if (remaining <= 0) break

    const basename = path.basename(rawPath)
    lines.push(`### ${basename}`)
    if (content.length > remaining) {
      if (remaining > MIN_TRUNCATE_CHARS) {
        lines.push(content.slice(0, Math.max(0, remaining - 50)) + "\n...(truncated)")
      }
      used = CONTEXT_SECTION_MAX_CHARS
      break
    }

    lines.push(content)
    lines.push("")
    used += content.length
  }

  return lines.join("\n")
}

function resolvePath(inputPath: string): string {
  let resolved = inputPath.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
    return process.env[varName] ?? ""
  })

  if (resolved.startsWith("~/")) {
    resolved = path.join(os.homedir(), resolved.slice(2))
  }

  return path.isAbsolute(resolved) ? resolved : path.resolve(Instance.directory, resolved)
}
