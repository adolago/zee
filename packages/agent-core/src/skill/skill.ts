import z from "zod"
import path from "path"
import os from "os"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { NamedError } from "@opencode-ai/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Session } from "@/session"

export namespace Skill {
  const log = Log.create({ service: "skill" })
  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    /** Persona context: undefined = shared, "zee"/"stanley"/"johny" = persona-specific */
    context: z.enum(["zee", "stanley", "johny"]).optional(),
  })
  export type Info = z.infer<typeof Info>

  /** Extract persona context from skill path (e.g., @zee/ordercli -> "zee") */
  function extractContext(skillPath: string): Info["context"] {
    const match = skillPath.match(/[/\\]@(zee|stanley|johny)[/\\]/)
    return match ? (match[1] as Info["context"]) : undefined
  }

  export const InvalidError = NamedError.create(
    "SkillInvalidError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
    }),
  )

  export const NameMismatchError = NamedError.create(
    "SkillNameMismatchError",
    z.object({
      path: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  )

  const OPENCODE_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")
  const CLAUDE_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")
  const SKILL_GLOB = new Bun.Glob("**/SKILL.md")

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}

    const addSkill = async (match: string) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      })

      if (!md) return

      const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
      if (!parsed.success) return

      // Warn on duplicate skill names
      if (skills[parsed.data.name]) {
        log.warn("duplicate skill name", {
          name: parsed.data.name,
          existing: skills[parsed.data.name].location,
          duplicate: match,
        })
      }

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
        context: extractContext(match),
      }
    }

    // Scan .agents/skills/ directories (project-level) - primary location
    const agentsDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".agents"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )
    // Also include global ~/.agents/skills/
    const globalAgents = `${Global.Path.home}/.agents`
    if (await Filesystem.isDir(globalAgents)) {
      agentsDirs.push(globalAgents)
    }

    for (const dir of agentsDirs) {
        const matches = await Array.fromAsync(
          CLAUDE_SKILL_GLOB.scan({
            cwd: dir,
            absolute: true,
            onlyFiles: true,
            followSymlinks: true,
            dot: true,
          }),
        ).catch((error) => {
          log.error("failed .agents directory scan for skills", { dir, error })
          return []
        })

        for (const match of matches) {
          await addSkill(match)
        }
      }

    // Scan .agent-core/skill/ directories
    for (const dir of await Config.directories()) {
      for await (const match of OPENCODE_SKILL_GLOB.scan({
        cwd: dir,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    // Scan additional skill paths from config
    const config = await Config.get()
    for (const skillPath of config.skills?.paths ?? []) {
      const expanded = skillPath.startsWith("~/") ? path.join(os.homedir(), skillPath.slice(2)) : skillPath
      const resolved = path.isAbsolute(expanded) ? expanded : path.join(Instance.directory, expanded)
      if (!(await Filesystem.isDir(resolved))) {
        log.warn("skill path not found", { path: resolved })
        continue
      }
      for await (const match of SKILL_GLOB.scan({
        cwd: resolved,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
      })) {
        await addSkill(match)
      }
    }

    return skills
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  /**
   * Get all skills, optionally filtered by agent/persona.
   * @param agent - If provided, returns only shared skills + skills for this persona.
   *                Skills from other personas (e.g., @stanley/ when agent=zee) are excluded.
   */
  export async function all(agent?: string): Promise<Info[]> {
    const skills: Info[] = await state().then((x) => Object.values(x))

    if (!agent) return skills

    // Normalize agent name to lowercase for matching
    const normalizedAgent = agent.toLowerCase()

    return skills.filter((skill) => {
      // Shared skills (no context) are always included
      if (!skill.context) return true
      // Persona-specific skills only included if they match the agent
      return skill.context === normalizedAgent
    })
  }
}
