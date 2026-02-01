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
  export const RegistryMeta = z.object({
    source: z.literal("clawhub"),
    id: z.string(),
    version: z.string(),
    installedAt: z.string(),
  })
  export type RegistryMeta = z.infer<typeof RegistryMeta>

  export const RequiresMeta = z.object({
    bins: z.array(z.string()).optional(),
    env: z.array(z.string()).optional(),
    config: z.array(z.string()).optional(),
    os: z.array(z.string()).optional(),
  })
  export type RequiresMeta = z.infer<typeof RequiresMeta>

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    /** Persona context: undefined = shared, "zee"/"stanley"/"johny" = persona-specific */
    context: z.enum(["zee", "stanley", "johny"]).optional(),
    /** Registry metadata for marketplace-installed skills. */
    registry: RegistryMeta.optional(),
    /** Gating requirements for the skill. */
    requires: RequiresMeta.optional(),
  })
  export type Info = z.infer<typeof Info>

  /** Skill with annotation about its relationship to the requesting persona. */
  export type AnnotatedInfo = Info & {
    /** "own" = matches persona, "shared" = no persona context, "cross" = belongs to another persona */
    affinity: "own" | "shared" | "cross"
  }

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

      // Detect ClawHub registry metadata from manifest
      let registry: RegistryMeta | undefined
      let requires: RequiresMeta | undefined
      if (match.includes("/@clawhub/")) {
        try {
          const manifestPath = path.join(path.dirname(match), "..", ".manifest.json")
          const manifestRaw = await Bun.file(manifestPath).text().catch(() => "")
          if (manifestRaw) {
            const manifest = JSON.parse(manifestRaw)
            const skillId = path.basename(path.dirname(match))
            const entry = manifest?.installed?.[skillId]
            if (entry) {
              registry = {
                source: "clawhub",
                id: entry.id,
                version: entry.version,
                installedAt: entry.installedAt,
              }
            }
          }
        } catch {
          // manifest unavailable; continue without registry info
        }
      }
      // Parse requires from frontmatter if present
      if (md.data.requires) {
        const requiresParsed = RequiresMeta.safeParse(md.data.requires)
        if (requiresParsed.success) {
          requires = requiresParsed.data
        }
      }

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
        context: extractContext(match),
        registry,
        requires,
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

    // Include ClawHub marketplace skills at ~/.agents/skills/@clawhub/
    const clawhubDir = `${Global.Path.home}/.agents/skills/@clawhub`
    if (await Filesystem.isDir(clawhubDir)) {
      agentsDirs.push(clawhubDir)
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

    // Scan .claude/skills/ directories (project-level) - Anthropic standard
    const claudeDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".claude"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )
    // Also include global ~/.claude/skills/
    const globalClaude = `${Global.Path.home}/.claude`
    if (await Filesystem.isDir(globalClaude)) {
      claudeDirs.push(globalClaude)
    }

    for (const dir of claudeDirs) {
      const matches = await Array.fromAsync(
        CLAUDE_SKILL_GLOB.scan({
          cwd: dir,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        }),
      ).catch((error) => {
        log.error("failed .claude directory scan for skills", { dir, error })
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
   * Get all skills, sorted by affinity to the requesting persona.
   *
   * Persona context is advisory, not exclusive: every persona can see every
   * skill. Skills are sorted so the persona's own skills come first, then
   * shared skills, then skills from other personas. This ensures the persona
   * system never blocks access to a capability.
   *
   * @param agent - If provided, sorts by affinity. Without it, returns all unsorted.
   */
  export async function all(agent?: string): Promise<AnnotatedInfo[]> {
    const skills: Info[] = await state().then((x) => Object.values(x))

    if (!agent) {
      return skills.map((s) => ({ ...s, affinity: s.context ? "own" : "shared" as const }))
    }

    const normalizedAgent = agent.toLowerCase()

    const annotated: AnnotatedInfo[] = skills.map((skill) => {
      if (!skill.context) return { ...skill, affinity: "shared" as const }
      if (skill.context === normalizedAgent) return { ...skill, affinity: "own" as const }
      return { ...skill, affinity: "cross" as const }
    })

    // Sort: own first, shared second, cross-persona last
    const affinityOrder = { own: 0, shared: 1, cross: 2 }
    annotated.sort((a, b) => affinityOrder[a.affinity] - affinityOrder[b.affinity])

    return annotated
  }
}
