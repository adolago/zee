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
    /** Primary environment variable name for API key injection. */
    primaryEnv: z.string().optional(),
    /** Paths of skills that were shadowed by this one (same name, loaded later). */
    conflicts: z.array(z.string()).optional(),
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

  /** Exclusion record: why a skill was filtered out. */
  export interface Exclusion {
    path: string
    name?: string
    reason: string
  }

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}
    const exclusions: Exclusion[] = []

    const addSkill = async (match: string) => {
      const md = await ConfigMarkdown.parse(match).catch((err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        exclusions.push({ path: match, reason: `parse error: ${message}` })
        return undefined
      })

      if (!md) return

      const parsed = Info.pick({ name: true, description: true }).safeParse(md.data)
      if (!parsed.success) {
        exclusions.push({
          path: match,
          reason: `invalid frontmatter: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
        })
        return
      }

      // Warn on duplicate skill names: keep first-loaded, track conflict
      if (skills[parsed.data.name]) {
        log.warn("duplicate skill name, keeping first-loaded", {
          name: parsed.data.name,
          kept: skills[parsed.data.name].location,
          shadowed: match,
        })
        // Track shadowed path on the winning skill
        const existing = skills[parsed.data.name]
        existing.conflicts = existing.conflicts ?? []
        existing.conflicts.push(match)
        exclusions.push({
          path: match,
          name: parsed.data.name,
          reason: `duplicate: shadowed by ${existing.location}`,
        })
        return
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

      // Extract primaryEnv from metadata (Zee-style frontmatter)
      const primaryEnv =
        typeof md.data.primaryEnv === "string" ? md.data.primaryEnv :
        typeof md.data.metadata?.primaryEnv === "string" ? md.data.metadata.primaryEnv :
        typeof md.data.metadata?.zee?.primaryEnv === "string" ? md.data.metadata.zee.primaryEnv :
        undefined

      // Check requires gates
      if (requires) {
        // OS check
        if (requires.os && requires.os.length > 0) {
          const currentOS = process.platform
          if (!requires.os.includes(currentOS)) {
            exclusions.push({
              path: match,
              name: parsed.data.name,
              reason: `OS mismatch: requires ${requires.os.join("|")}, running ${currentOS}`,
            })
            log.debug("skill excluded: OS mismatch", { skill: parsed.data.name, requires: requires.os, current: currentOS })
            return
          }
        }

        // Binary check
        if (requires.bins && requires.bins.length > 0) {
          const missingBins: string[] = []
          for (const bin of requires.bins) {
            try {
              const result = Bun.spawnSync(["which", bin], { stdout: "pipe", stderr: "pipe" })
              if (result.exitCode !== 0) {
                missingBins.push(bin)
              }
            } catch {
              missingBins.push(bin)
            }
          }
          if (missingBins.length > 0) {
            exclusions.push({
              path: match,
              name: parsed.data.name,
              reason: `missing binary: ${missingBins.join(", ")}`,
            })
            log.debug("skill excluded: missing binaries", { skill: parsed.data.name, missing: missingBins })
            return
          }
        }

        // Env var check
        if (requires.env && requires.env.length > 0) {
          const missingEnv = requires.env.filter((e) => !process.env[e])
          if (missingEnv.length > 0) {
            exclusions.push({
              path: match,
              name: parsed.data.name,
              reason: `missing required env: ${missingEnv.join(", ")}`,
            })
            log.debug("skill excluded: missing env vars", { skill: parsed.data.name, missing: missingEnv })
            return
          }
        }
      }

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
        context: extractContext(match),
        registry,
        requires,
        primaryEnv,
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

    // Check for config-disabled skills
    const configEntries = config.skills?.entries
    if (configEntries) {
      for (const [name, entry] of Object.entries(configEntries)) {
        if (entry && typeof entry === "object" && "disabled" in entry && entry.disabled && skills[name]) {
          exclusions.push({
            path: skills[name].location,
            name,
            reason: "disabled in config.skills.entries",
          })
          log.debug("skill excluded: disabled in config", { skill: name })
          delete skills[name]
        }
      }
    }

    return { skills, exclusions }
  })

  /**
   * Return the canonical ordered list of all skill scan directories.
   * Used by the skill watcher and other consumers that need to know
   * where skills can be found.
   *
   * Directories are returned in load-precedence order (first wins on conflict).
   * Not all directories may exist on disk.
   */
  export async function directories(): Promise<string[]> {
    const dirs: string[] = []

    // .agents/skills/ directories (project-level) - primary location
    const agentsDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".agents"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )
    for (const d of agentsDirs) {
      dirs.push(path.join(d, "skills"))
    }

    // Global ~/.agents/skills/
    dirs.push(path.join(Global.Path.home, ".agents", "skills"))

    // ClawHub marketplace skills
    dirs.push(path.join(Global.Path.home, ".agents", "skills", "@clawhub"))

    // .claude/skills/ directories (project-level) - Anthropic standard
    const claudeDirs = await Array.fromAsync(
      Filesystem.up({
        targets: [".claude"],
        start: Instance.directory,
        stop: Instance.worktree,
      }),
    )
    for (const d of claudeDirs) {
      dirs.push(path.join(d, "skills"))
    }

    // Global ~/.claude/skills/
    dirs.push(path.join(Global.Path.home, ".claude", "skills"))

    // .agent-core config directories
    for (const d of await Config.directories()) {
      dirs.push(d)
    }

    // Additional skill paths from config
    const config = await Config.get()
    for (const skillPath of config.skills?.paths ?? []) {
      const expanded = skillPath.startsWith("~/") ? path.join(os.homedir(), skillPath.slice(2)) : skillPath
      const resolved = path.isAbsolute(expanded) ? expanded : path.join(Instance.directory, expanded)
      dirs.push(resolved)
    }

    return dirs
  }

  export async function get(name: string) {
    return state().then((x) => x.skills[name])
  }

  /** Get the list of excluded skills with reasons. */
  export async function getExclusions(): Promise<Exclusion[]> {
    return state().then((x) => x.exclusions)
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
    const skills: Info[] = await state().then((x) => Object.values(x.skills))

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

  /** Audit report for skill health diagnostics. */
  export interface AuditReport {
    /** Successfully loaded skills. */
    loaded: Info[]
    /** Skills that were excluded with reasons. */
    excluded: Exclusion[]
    /** Skills with name conflicts (first-loaded won). */
    conflicts: Array<{ name: string; kept: string; shadowed: string[] }>
    /** Skills with missing required environment variables. */
    missingEnv: Array<{ skill: string; vars: string[] }>
  }

  /**
   * Generate a comprehensive skill audit report.
   * Includes loaded skills, exclusions, conflicts, and missing env vars.
   */
  export async function audit(): Promise<AuditReport> {
    const { skills, exclusions } = await state()
    const loaded = Object.values(skills)

    // Extract conflicts from loaded skills
    const conflicts: AuditReport["conflicts"] = loaded
      .filter((s) => s.conflicts && s.conflicts.length > 0)
      .map((s) => ({
        name: s.name,
        kept: s.location,
        shadowed: s.conflicts!,
      }))

    // Check for missing env vars (non-blocking: skill loaded but may not work)
    const missingEnv: AuditReport["missingEnv"] = []
    for (const skill of loaded) {
      const missing: string[] = []
      if (skill.primaryEnv && !process.env[skill.primaryEnv]) {
        missing.push(skill.primaryEnv)
      }
      if (skill.requires?.env) {
        for (const env of skill.requires.env) {
          if (!process.env[env] && !missing.includes(env)) {
            missing.push(env)
          }
        }
      }
      if (missing.length > 0) {
        missingEnv.push({ skill: skill.name, vars: missing })
      }
    }

    return { loaded, excluded: exclusions, conflicts, missingEnv }
  }
}
