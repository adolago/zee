import z from "zod"
import path from "path"
import os from "os"
import { spawnSync } from "node:child_process"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { NamedError } from "@zee/util/error"
import { ConfigMarkdown } from "../config/markdown"
import { Log } from "../util/log"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { scanDirectoryWithSummary, type SkillScanFinding } from "./scanner"
import { PermissionNext } from "@/permission/next"
import { parse as parseYaml } from "yaml"

export namespace Skill {
  const log = Log.create({ service: "skill" })

  export const RequiresMeta = z.object({
    bins: z.array(z.string()).optional(),
    /** At least one of these binaries must be available (vs all for `bins`). */
    anyBins: z.array(z.string()).optional(),
    env: z.array(z.string()).optional(),
    config: z.array(z.string()).optional(),
    os: z.array(z.string()).optional(),
  })
  export type RequiresMeta = z.infer<typeof RequiresMeta>

  function parseMetadata(raw: unknown): Record<string, unknown> | undefined {
    if (!raw) return undefined
    if (typeof raw === "object") return raw as Record<string, unknown>
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
      } catch {
        return undefined
      }
    }
    return undefined
  }

  function mergeRequires(base: RequiresMeta | undefined, next: RequiresMeta): RequiresMeta {
    if (!base) return next

    return {
      bins: [...new Set([...(base.bins ?? []), ...(next.bins ?? [])])],
      anyBins: [...new Set([...(base.anyBins ?? []), ...(next.anyBins ?? [])])],
      env: [...new Set([...(base.env ?? []), ...(next.env ?? [])])],
      config: [...new Set([...(base.config ?? []), ...(next.config ?? [])])],
      os: [...new Set([...(base.os ?? []), ...(next.os ?? [])])],
    }
  }

  export const Info = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    /** Assistant context: "zee" for Zee-owned skills; undefined for shared capability packs. */
    context: z.literal("zee").optional(),
    /** Gating requirements for the skill. */
    requires: RequiresMeta.optional(),
    /** Primary environment variable name for API key injection. */
    primaryEnv: z.string().optional(),
    /** Paths of skills that were shadowed by this one (same name, loaded later). */
    conflicts: z.array(z.string()).optional(),
    /** Searchable tags for skill discovery. */
    tags: z.array(z.string()).optional(),
    /** Trigger phrases that indicate this skill should be used. */
    triggers: z.array(z.string()).optional(),
    /** Skill version (semver). */
    version: z.string().optional(),
    /** Skill author. */
    author: z.string().optional(),
    /** Skill category for grouping. */
    category: z.string().optional(),
    /** Source identifier (e.g. "zee"). */
    source: z.string().optional(),
    /** Homepage URL. */
    homepage: z.string().optional(),
  })
  export type Info = z.infer<typeof Info>

  /** Skill with annotation about its relationship to the requesting assistant. */
  export type AnnotatedInfo = Info & {
    affinity: "shared"
  }

  export type PermissionReadiness = "allow" | "ask" | "deny"
  export type EnvReadiness = "ready" | "partial" | "missing" | "not-required"
  export type BinaryReadiness = "ready" | "missing" | "not-required"
  export type OsReadiness = "ready" | "mismatch" | "not-required"

  export interface Readiness {
    permission: PermissionReadiness
    env: EnvReadiness
    missingEnv: string[]
    bins: BinaryReadiness
    os: OsReadiness
    missingBins: string[]
    missingAnyBins: string[]
    blocked: boolean
    blockedReasons: string[]
  }

  export type ReadyInfo = AnnotatedInfo & {
    readiness: Readiness
  }

  export interface Recommendation {
    name: string
    description: string
    location: string
    affinity: AnnotatedInfo["affinity"]
    context?: Info["context"]
    score: number
    reason: string
    readiness: Readiness
  }

  /** Extract Zee-owned context from skill path. Legacy domain folders are treated as shared skills. */
  function extractContext(skillPath: string): Info["context"] {
    const match = skillPath.match(/[/\\]@(zee)[/\\]/)
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

  const ZEE_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")
  const CLAUDE_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")
  const SKILL_GLOB = new Bun.Glob("**/SKILL.md")

  /** Exclusion record: why a skill was filtered out. */
  export interface Exclusion {
    path: string
    name?: string
    reason: string
  }

  /** Schema warning: a skill has frontmatter keys not recognized by the schema. */
  export interface SchemaWarning {
    skill: string
    path: string
    unknownKeys: string[]
  }

  /** Keys recognized in SKILL.md frontmatter (excludes internal-only fields like location). */
  const KNOWN_FRONTMATTER_KEYS = new Set([
    "name",
    "description",
    "context",
    "requires",
    "primaryEnv",
    "tags",
    "triggers",
    "version",
    "author",
    "category",
    "source",
    "homepage",
    // Common metadata containers (not in Info but structurally valid)
    "metadata",
    "registry",
    "emoji",
    "progressive_disclosure",
  ])

  const AliasConfig = z.object({
    version: z.number().optional(),
    aliases: z.record(z.string(), z.string()),
  })

  function resolveAlias(name: string, aliases: Record<string, string>): string {
    return aliases[name] ?? aliases[name.toLowerCase()] ?? name
  }

  async function loadAliases(): Promise<Record<string, string>> {
    const aliasesPath = path.join(Global.Path.source, "packages", "zee", "skills", "aliases.yaml")
    const raw = await Bun.file(aliasesPath)
      .text()
      .catch(() => "")
    if (!raw.trim()) return {}

    try {
      const parsed = AliasConfig.safeParse(parseYaml(raw))
      if (!parsed.success) {
        log.warn("invalid skill alias config; ignoring aliases", {
          aliasesPath,
          issues: parsed.error.issues.map((issue) => issue.message),
        })
        return {}
      }

      const aliases: Record<string, string> = {}
      for (const [legacy, canonical] of Object.entries(parsed.data.aliases)) {
        aliases[legacy] = canonical
        aliases[legacy.toLowerCase()] = canonical
      }
      return aliases
    } catch (error) {
      log.warn("failed to parse skill aliases; continuing without alias map", {
        aliasesPath,
        error: error instanceof Error ? error.message : String(error),
      })
      return {}
    }
  }

  function normalizeText(value: string): string {
    return value.trim().toLowerCase()
  }

  function getBundledSkillConfigDir(): string {
    return path.resolve(path.join(Global.Path.source, ".zee"))
  }

  function shouldSkipBundledSkillDir(dir: string, hasCanonicalSkillRoots: boolean): boolean {
    if (!hasCanonicalSkillRoots) return false
    return path.resolve(dir) === getBundledSkillConfigDir()
  }

  const STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "then",
    "into",
    "onto",
    "your",
    "have",
    "has",
    "had",
    "set",
    "to",
    "at",
    "in",
    "on",
    "of",
    "a",
    "an",
    "is",
    "it",
    "be",
    "by",
    "or",
    "as",
    "me",
    "my",
    "you",
    "we",
    "our",
  ])

  function tokenize(value: string): string[] {
    return normalizeText(value)
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  }

  function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  function containsWord(text: string, word: string): boolean {
    const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, "i")
    return pattern.test(text)
  }

  const binaryAvailabilityCache = new Map<string, boolean>()

  function hasBinary(binaryName: string): boolean {
    if (binaryAvailabilityCache.has(binaryName)) {
      return binaryAvailabilityCache.get(binaryName)!
    }

    const command = process.platform === "win32" ? "where" : "which"
    let found = false
    try {
      const result = spawnSync(command, [binaryName], { stdio: "pipe", timeout: 3000 })
      found = result.status === 0
    } catch {
      found = false
    }

    binaryAvailabilityCache.set(binaryName, found)
    return found
  }

  function uniqueEnvRequirements(skill: Info): string[] {
    const required = new Set<string>()
    if (skill.primaryEnv) required.add(skill.primaryEnv)
    for (const env of skill.requires?.env ?? []) {
      required.add(env)
    }
    return [...required]
  }

  type EnvResolutionContext = {
    config: Awaited<ReturnType<typeof Config.get>>
  }

  async function createEnvResolutionContext(): Promise<EnvResolutionContext> {
    return {
      config: await Config.get(),
    }
  }

  function hasConfigEnvValue(
    skill: Info,
    envName: string,
    config: Awaited<ReturnType<typeof Config.get>>,
    canonicalEnvNames: string[],
  ): boolean {
    const entry = config.skills?.entries?.[skill.name]
    if (!entry) return false

    if (entry.env?.[envName]) return true
    if (canonicalEnvNames.some((name) => entry.env?.[name])) return true

    if (skill.primaryEnv === envName && entry.apiKey) return true
    if (skill.primaryEnv && canonicalEnvNames.includes(skill.primaryEnv) && entry.apiKey) return true

    return false
  }

  function isEnvSatisfied(skill: Info, envName: string, ctx: EnvResolutionContext): boolean {
    if (process.env[envName]) return true
    if (hasConfigEnvValue(skill, envName, ctx.config, [envName])) return true
    return false
  }

  async function readinessForSkill(
    skill: Info,
    permission?: PermissionNext.Ruleset,
    ctx?: EnvResolutionContext,
  ): Promise<Readiness> {
    const effectiveContext = ctx ?? (await createEnvResolutionContext())
    const requires = skill.requires
    const required = uniqueEnvRequirements(skill)
    const missingEnv = required.filter((envName) => !isEnvSatisfied(skill, envName, effectiveContext))
    const requiredBins = requires?.bins ?? []
    const missingBins = requiredBins.filter((bin) => !hasBinary(bin))
    const anyBins = requires?.anyBins ?? []
    const anyBinsSatisfied = anyBins.length === 0 ? true : anyBins.some((bin) => hasBinary(bin))
    const missingAnyBins = anyBins.length > 0 && !anyBinsSatisfied ? [...anyBins] : []
    const requiredOS = requires?.os ?? []
    const osMismatch = requiredOS.length > 0 && !requiredOS.includes(process.platform)

    const env: EnvReadiness =
      required.length === 0
        ? "not-required"
        : missingEnv.length === 0
          ? "ready"
          : missingEnv.length === required.length
            ? "missing"
            : "partial"

    const permissionStatus = permission
      ? PermissionNext.evaluate("skill", skill.name, permission).action
      : ("allow" as PermissionReadiness)

    const bins: BinaryReadiness =
      requiredBins.length === 0 && anyBins.length === 0
        ? "not-required"
        : missingBins.length === 0 && missingAnyBins.length === 0
          ? "ready"
          : "missing"

    const os: OsReadiness = requiredOS.length === 0 ? "not-required" : osMismatch ? "mismatch" : "ready"

    const blockedReasons: string[] = []
    if (permissionStatus === "deny") {
      blockedReasons.push("permission denied by current policy")
    }
    if (osMismatch) {
      blockedReasons.push(`unsupported OS (requires: ${requiredOS.join(", ")}, current: ${process.platform})`)
    }
    if (missingBins.length > 0) {
      blockedReasons.push(`missing binaries: ${missingBins.join(", ")}`)
    }
    if (missingAnyBins.length > 0) {
      blockedReasons.push(`requires at least one binary from: ${missingAnyBins.join(", ")}`)
    }
    if (missingEnv.length > 0) {
      blockedReasons.push(`missing environment variables: ${missingEnv.join(", ")}`)
    }

    return {
      permission: permissionStatus,
      env,
      missingEnv,
      bins,
      os,
      missingBins,
      missingAnyBins,
      blocked: blockedReasons.length > 0,
      blockedReasons,
    }
  }

  function scoreSkill(query: string, skill: AnnotatedInfo): { score: number; reason: string } {
    const q = normalizeText(query)
    const tokens = tokenize(query)
    if (!q) return { score: 0, reason: "empty query" }

    let score = 0
    const reasons: string[] = []
    const nameLower = skill.name.toLowerCase()
    const descriptionLower = skill.description.toLowerCase()
    const triggerLower = (skill.triggers ?? []).map((item) => item.toLowerCase())
    const tagsLower = (skill.tags ?? []).map((item) => item.toLowerCase())

    if (nameLower === q) {
      score += 14
      reasons.push("exact name")
    } else if (nameLower.includes(q)) {
      score += 10
      reasons.push("name match")
    }

    if (descriptionLower.includes(q)) {
      score += 6
      reasons.push("description phrase")
    }

    for (const trigger of triggerLower) {
      if (trigger.includes(q) || q.includes(trigger)) {
        score += 8
        reasons.push("trigger phrase")
        break
      }
    }

    for (const token of tokens) {
      let tokenScored = false
      if (containsWord(nameLower, token) || nameLower.includes(token)) {
        score += 3
        tokenScored = true
      }
      if (containsWord(descriptionLower, token)) {
        score += 3
        tokenScored = true
      }
      if (tagsLower.some((tag) => containsWord(tag, token))) {
        score += 3
        tokenScored = true
      }
      if (triggerLower.some((trigger) => containsWord(trigger, token))) {
        score += 4
        tokenScored = true
      }
      if (tokenScored) {
        reasons.push(`token:${token}`)
      }
    }

    const uniqueReasons = [...new Set(reasons)]
    return {
      score,
      reason: uniqueReasons.slice(0, 3).join(", ") || "weak lexical match",
    }
  }

  export const state = Instance.state(async () => {
    const skills: Record<string, Info> = {}
    const exclusions: Exclusion[] = []
    const schemaWarnings: SchemaWarning[] = []
    const aliases = await loadAliases()

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

      // Detect unknown frontmatter keys
      if (md.data && typeof md.data === "object") {
        const unknownKeys = Object.keys(md.data).filter((k) => !KNOWN_FRONTMATTER_KEYS.has(k))
        if (unknownKeys.length > 0) {
          log.debug("skill has unknown frontmatter keys", { skill: parsed.data.name, unknownKeys })
          schemaWarnings.push({ skill: parsed.data.name, path: match, unknownKeys })
        }
      }

      let requires: RequiresMeta | undefined
      const metadata = parseMetadata(md.data.metadata)
      const requiresCandidates = [
        md.data.requires,
        metadata && typeof (metadata as { requires?: unknown }).requires !== "undefined"
          ? (metadata as { requires?: unknown }).requires
          : undefined,
        metadata && typeof (metadata as { zee?: { requires?: unknown } }).zee?.requires !== "undefined"
          ? (metadata as { zee?: { requires?: unknown } }).zee?.requires
          : undefined,
      ].filter((candidate) => candidate !== undefined)

      for (const candidate of requiresCandidates) {
        const requiresParsed = RequiresMeta.safeParse(candidate)
        if (requiresParsed.success) {
          requires = mergeRequires(requires, requiresParsed.data)
        }
      }

      const primaryEnv =
        typeof md.data.primaryEnv === "string"
          ? md.data.primaryEnv
          : metadata && typeof (metadata as { primaryEnv?: unknown }).primaryEnv === "string"
            ? (metadata as { primaryEnv?: string }).primaryEnv
            : metadata && typeof (metadata as { zee?: { primaryEnv?: unknown } }).zee?.primaryEnv === "string"
              ? (metadata as { zee?: { primaryEnv?: string } }).zee?.primaryEnv
              : undefined

      // Parse requires metadata. Runtime availability is evaluated at readiness time.
      if (requires) {
        if (requires.os && requires.os.length > 0) {
          const currentOS = process.platform
          if (!requires.os.includes(currentOS)) {
            log.debug("skill OS requirement not met; readiness gate will block execution", {
              skill: parsed.data.name,
              requires: requires.os,
              current: currentOS,
            })
          }
        }

        if (requires.bins && requires.bins.length > 0) {
          const missingBins = requires.bins.filter((bin) => !hasBinary(bin))
          if (missingBins.length > 0) {
            log.debug("skill missing required binaries; readiness gate will block execution", {
              skill: parsed.data.name,
              missing: missingBins,
            })
          }
        }

        if (requires.anyBins && requires.anyBins.length > 0) {
          const foundAny = requires.anyBins.some((bin) => hasBinary(bin))
          if (!foundAny) {
            log.debug("skill missing anyBins requirements; readiness gate will block execution", {
              skill: parsed.data.name,
              anyBins: requires.anyBins,
            })
          }
        }

        if (requires.env && requires.env.length > 0) {
          const missingEnv = requires.env.filter((e) => !process.env[e])
          if (missingEnv.length > 0) {
            // Missing env vars are non-blocking: skill can load but may fail at runtime.
            log.debug("skill missing env vars", { skill: parsed.data.name, missing: missingEnv })
          }
        }
      }

      // Parse tags and triggers from frontmatter
      const tags = Array.isArray(md.data.tags) ? md.data.tags.filter((t: unknown) => typeof t === "string") : undefined
      const triggers = Array.isArray(md.data.triggers)
        ? md.data.triggers.filter((t: unknown) => typeof t === "string")
        : undefined

      // Extract optional schema fields from frontmatter
      const version = typeof md.data.version === "string" ? md.data.version : undefined
      const author =
        typeof md.data.author === "string"
          ? md.data.author
          : Array.isArray(md.data.authors) && typeof md.data.authors[0] === "string"
            ? md.data.authors[0]
            : undefined
      const category = typeof md.data.category === "string" ? md.data.category : undefined
      const source = typeof md.data.source === "string" ? md.data.source : undefined
      const homepage = typeof md.data.homepage === "string" ? md.data.homepage : undefined

      skills[parsed.data.name] = {
        name: parsed.data.name,
        description: parsed.data.description,
        location: match,
        context: extractContext(match),
        requires,
        primaryEnv,
        ...(tags && tags.length > 0 ? { tags } : {}),
        ...(triggers && triggers.length > 0 ? { triggers } : {}),
        ...(version ? { version } : {}),
        ...(author ? { author } : {}),
        ...(category ? { category } : {}),
        ...(source ? { source } : {}),
        ...(homepage ? { homepage } : {}),
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
    const hasCanonicalSkillRoots = agentsDirs.length > 0

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

    // Scan .zee/skill/ directories
    for (const dir of await Config.directories()) {
      if (shouldSkipBundledSkillDir(dir, hasCanonicalSkillRoots)) {
        continue
      }
      for await (const match of ZEE_SKILL_GLOB.scan({
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

    // Skill toggles are intentionally ignored: all discovered skills stay enabled.
    const configEntries = config.skills?.entries
    if (configEntries) {
      for (const [name, entry] of Object.entries(configEntries)) {
        if (entry?.enabled === false && skills[name]) {
          log.warn("Ignoring skills.entries enabled=false; skills are always enabled", { skill: name })
        }
      }
    }

    return { skills, exclusions, schemaWarnings, aliases }
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
    const globalAgentsSkills = path.join(Global.Path.home, ".agents", "skills")
    dirs.push(globalAgentsSkills)
    const hasCanonicalSkillRoots = agentsDirs.length > 0 || (await Filesystem.isDir(path.join(Global.Path.home, ".agents")))

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

    // .zee config directories
    for (const d of await Config.directories()) {
      if (shouldSkipBundledSkillDir(d, hasCanonicalSkillRoots)) {
        continue
      }
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
    const { skills, aliases } = await state()
    const resolved = resolveAlias(name, aliases)
    if (resolved !== name) {
      log.warn("resolved legacy skill alias", { requested: name, canonical: resolved })
    }
    return skills[resolved]
  }

  /** Get the list of excluded skills with reasons. */
  export async function getExclusions(): Promise<Exclusion[]> {
    return state().then((x) => x.exclusions)
  }

  /**
   * Get all skills for the single-Zee runtime.
   *
   * Skill context is advisory, not exclusive: every assistant entry point can
   * see every capability pack. The optional agent parameter remains for
   * compatibility and permission/readiness lookups, but no longer affects
   * ordering or affinity.
   */
  export async function all(_agent?: string): Promise<AnnotatedInfo[]> {
    const skills: Info[] = await state().then((x) => Object.values(x.skills))
    return [...skills]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((skill) => ({ ...skill, affinity: "shared" as const }))
  }

  /**
   * Search skills by keyword across name, description, tags, and triggers.
   * Results use the shared single-Zee skill ordering.
   */
  export async function search(query: string, agent?: string): Promise<AnnotatedInfo[]> {
    const skills = await all(agent)
    const q = query.toLowerCase()
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags?.some((t) => t.toLowerCase().includes(q)) ||
        s.triggers?.some((t) => t.toLowerCase().includes(q)),
    )
  }

  export async function readiness(skill: Info, permission?: PermissionNext.Ruleset): Promise<Readiness> {
    return readinessForSkill(skill, permission)
  }

  export async function index(agent?: string, permission?: PermissionNext.Ruleset): Promise<ReadyInfo[]> {
    const skills = await all(agent)
    const envContext = await createEnvResolutionContext()

    return Promise.all(
      skills.map(async (skill) => ({
        ...skill,
        readiness: await readinessForSkill(skill, permission, envContext),
      })),
    )
  }

  export async function recommend(
    query: string,
    agent?: string,
    options?: {
      limit?: number
      minScore?: number
      permission?: PermissionNext.Ruleset
    },
  ): Promise<Recommendation[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    const limit = Math.max(1, Math.min(20, options?.limit ?? 3))
    const minScore = options?.minScore ?? 3
    const candidates = await all(agent)
    const envContext = await createEnvResolutionContext()

    const ranked: Recommendation[] = []

    for (const skill of candidates) {
      const readiness = await readinessForSkill(skill, options?.permission, envContext)
      if (readiness.permission === "deny") continue

      const lexical = scoreSkill(trimmed, skill)
      if (lexical.score <= 0) continue

      const reasonParts = [lexical.reason]
      if (readiness.permission === "ask") {
        reasonParts.push("requires permission prompt")
      }
      if (readiness.env === "missing" || readiness.env === "partial") {
        reasonParts.push(`env: ${readiness.env}`)
      }
      if (readiness.bins === "missing") {
        reasonParts.push("deps: missing binaries")
      }
      if (readiness.os === "mismatch") {
        reasonParts.push("deps: unsupported OS")
      }

      ranked.push({
        name: skill.name,
        description: skill.description,
        location: skill.location,
        affinity: skill.affinity,
        context: skill.context,
        score: lexical.score,
        reason: reasonParts.join("; "),
        readiness,
      })
    }

    ranked.sort((a, b) => b.score - a.score)
    return ranked.filter((item) => item.score >= minScore).slice(0, limit)
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
    /** Skills with unknown frontmatter keys not in the schema. */
    schemaWarnings: SchemaWarning[]
    /** Code safety scan results per skill directory. */
    codeSafety?: Array<{
      skill: string
      directory: string
      critical: number
      warn: number
      findings: SkillScanFinding[]
    }>
  }

  /**
   * Generate a comprehensive skill audit report.
   * Includes loaded skills, exclusions, conflicts, and missing env vars.
   */
  export async function audit(): Promise<AuditReport> {
    const { skills, exclusions, schemaWarnings } = await state()
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
    const envContext = await createEnvResolutionContext()
    for (const skill of loaded) {
      const readiness = await readinessForSkill(skill, undefined, envContext)
      if (readiness.missingEnv.length > 0) {
        missingEnv.push({ skill: skill.name, vars: readiness.missingEnv })
      }
    }

    // Code safety scanning: scan the parent directory of each loaded skill
    const codeSafety: AuditReport["codeSafety"] = []
    const scannedDirs = new Set<string>()
    for (const skill of loaded) {
      const skillDir = path.dirname(skill.location)
      if (scannedDirs.has(skillDir)) continue
      scannedDirs.add(skillDir)
      try {
        const summary = await scanDirectoryWithSummary(skillDir)
        if (summary.findings.length > 0) {
          codeSafety.push({
            skill: skill.name,
            directory: skillDir,
            critical: summary.critical,
            warn: summary.warn,
            findings: summary.findings,
          })
        }
      } catch {
        // Scan failure for a single skill directory is non-fatal
      }
    }

    return {
      loaded,
      excluded: exclusions,
      conflicts,
      missingEnv,
      schemaWarnings,
      ...(codeSafety.length > 0 ? { codeSafety } : {}),
    }
  }
}
