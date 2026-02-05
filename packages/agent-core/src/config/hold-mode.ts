import z from "zod"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { parse as parseYaml } from "yaml"
import { resolveConfigDir } from "../global/dirs"

const log = Log.create({ service: "hold-mode" })

export namespace HoldMode {
  export const ProfileSchema = z.enum(["strict", "normal", "permissive"])
  export type Profile = z.infer<typeof ProfileSchema>

  export const ConfigSchema = z.object({
    profile: ProfileSchema.default("normal"),
    always_block: z.array(z.string()).default([]),
    hold_allow: z.array(z.string()).default([]),
    release_confirm: z.array(z.string()).default([]),
    tools: z.object({
      edit: z.boolean().optional(),
      write: z.boolean().optional(),
      apply_patch: z.boolean().optional(),
      todowrite: z.boolean().optional(),
    }).default({}),
  })

  export type Config = z.infer<typeof ConfigSchema>

  const STRICT_ADDITIONS = new Set([
    "curl", "wget", "nc", "netcat", "ssh", "scp", "rsync",
    "python", "python3", "node", "ruby", "perl", "php",
    "eval", "exec", "source", ".",
    "crontab", "at", "batch",
    "docker", "podman", "kubectl", "helm",
    "aws", "gcloud", "az",
  ])

  const PERMISSIVE_REMOVALS = new Set([
    "touch", "mkdir",
  ])

  let cachedConfig: Config | null = null

  // PERFORMANCE: Cache checkCommand results to avoid redundant regex matching
  // Commands are checked on every bash execution, but config rarely changes
  const CHECK_CACHE_TTL_MS = 5000 // 5 seconds
  interface CheckCacheEntry {
    result: CheckResult
    timestamp: number
  }
  const checkCache = new Map<string, CheckCacheEntry>()

  function configDir(): string {
    return resolveConfigDir()
  }

  function userConfigPath(): string {
    return path.join(configDir(), "hold-mode.yaml")
  }

  function projectConfigPath(): string {
    return path.join(Instance.directory, ".agent-core", "hold-mode.yaml")
  }

  async function loadYamlFile(filepath: string): Promise<Partial<Config>> {
    try {
      if (!existsSync(filepath)) return {}
      const content = await fs.readFile(filepath, "utf-8")
      const parsed = parseYaml(content)
      return ConfigSchema.partial().parse(parsed ?? {})
    } catch (error) {
      log.warn("failed to load hold-mode config", { filepath, error })
      return {}
    }
  }

  // Security ordering: lower index = more restrictive
  const PROFILE_SECURITY_ORDER: Profile[] = ["strict", "normal", "permissive"]

  function getMoreRestrictiveProfile(a: Profile | undefined, b: Profile | undefined): Profile {
    const defaultProfile: Profile = "normal"
    const profileA = a ?? defaultProfile
    const profileB = b ?? defaultProfile
    const indexA = PROFILE_SECURITY_ORDER.indexOf(profileA)
    const indexB = PROFILE_SECURITY_ORDER.indexOf(profileB)
    // Lower index = more restrictive, so pick the minimum
    return indexA <= indexB ? profileA : profileB
  }

  function mergeToolsSecurity(
    userTools: Config["tools"],
    projectTools: Config["tools"],
    warnings: string[]
  ): Config["tools"] {
    const result: Config["tools"] = {}
    const toolNames: (keyof Config["tools"])[] = ["edit", "write", "apply_patch", "todowrite"]

    for (const tool of toolNames) {
      const userVal = userTools[tool]
      const projectVal = projectTools[tool]

      // SECURITY: User `false` (blocked) ALWAYS wins - project cannot enable blocked tools
      // Project can only make tools MORE restrictive, never less
      if (userVal === false) {
        // User blocked this tool - project cannot override
        if (projectVal === true) {
          warnings.push(`project config attempted to enable '${tool}' tool blocked by user config`)
        }
        result[tool] = false
      } else if (projectVal === false) {
        // Project blocks this tool - allowed (more restrictive)
        result[tool] = false
      } else if (userVal === true && projectVal === true) {
        result[tool] = true
      } else if (userVal === true && projectVal === undefined) {
        result[tool] = true
      } else if (userVal === undefined && projectVal === true) {
        // SECURITY: Project tries to enable a tool the user didn't explicitly allow
        // Only user can grant tool permissions
        warnings.push(`project config attempted to enable '${tool}' tool not explicitly allowed by user`)
        result[tool] = undefined
      } else {
        // Both undefined
        result[tool] = undefined
      }
    }

    return result
  }

  export async function load(): Promise<Config> {
    if (cachedConfig) return cachedConfig

    const userConfig = await loadYamlFile(userConfigPath())
    const projectConfig = await loadYamlFile(projectConfigPath())
    const securityWarnings: string[] = []

    // SECURITY: Profile - always use the MORE restrictive of user vs project
    // This prevents malicious repos from setting `profile: permissive` to weaken user's strict settings
    const userProfile = userConfig.profile
    const projectProfile = projectConfig.profile
    const effectiveProfile = getMoreRestrictiveProfile(userProfile, projectProfile)

    if (projectProfile !== undefined && userProfile !== undefined) {
      const userIdx = PROFILE_SECURITY_ORDER.indexOf(userProfile)
      const projectIdx = PROFILE_SECURITY_ORDER.indexOf(projectProfile)
      if (projectIdx > userIdx) {
        // Project tried to weaken (e.g., user=strict, project=permissive)
        securityWarnings.push(
          `project config attempted to weaken profile from '${userProfile}' to '${projectProfile}' - using '${effectiveProfile}'`
        )
      }
    }

    // SECURITY: always_block - additive only (concatenate both)
    // Both user and project can add commands to block - this is correct
    const always_block = [
      ...(userConfig.always_block ?? []),
      ...(projectConfig.always_block ?? []),
    ]

    // SECURITY: hold_allow - user config ONLY
    // These are security exceptions - project should NOT be able to add allowances
    // A malicious repo could add dangerous commands to hold_allow to bypass blocking
    const hold_allow = userConfig.hold_allow ?? []
    if (projectConfig.hold_allow && projectConfig.hold_allow.length > 0) {
      securityWarnings.push(
        `project config attempted to add hold_allow exceptions: [${projectConfig.hold_allow.join(", ")}] - ignored for security`
      )
    }

    // SECURITY: release_confirm - additive (project can add confirmations, not remove)
    // Project can require MORE confirmation (more restrictive), never less
    // User's confirmations are always preserved
    const release_confirm = [
      ...(userConfig.release_confirm ?? []),
      ...(projectConfig.release_confirm ?? []),
    ]

    // SECURITY: tools - user blocks always win, project can only restrict
    const tools = mergeToolsSecurity(
      userConfig.tools ?? {},
      projectConfig.tools ?? {},
      securityWarnings
    )

    // Log security warnings so users know their preferences were preserved
    for (const warning of securityWarnings) {
      log.warn("security policy preserved user settings", { detail: warning })
    }

    const merged: Config = ConfigSchema.parse({
      profile: effectiveProfile,
      always_block,
      hold_allow,
      release_confirm,
      tools,
    })

    cachedConfig = merged
    log.info("loaded hold-mode config", { profile: merged.profile })
    return merged
  }

  export function invalidateCache(): void {
    cachedConfig = null
    // PERFORMANCE: Also invalidate command check cache since config changed
    checkCache.clear()
  }

  export function getStrictAdditions(): Set<string> {
    return STRICT_ADDITIONS
  }

  export function getPermissiveRemovals(): Set<string> {
    return PERMISSIVE_REMOVALS
  }

  export function matchesPattern(command: string, patterns: string[]): boolean {
    return findMatchingPattern(command, patterns) !== null
  }

  export function findMatchingPattern(command: string, patterns: string[]): string | null {
    const trimmed = command.trim().toLowerCase()
    for (const pattern of patterns) {
      const p = pattern.toLowerCase()
      if (p.endsWith("*")) {
        if (trimmed.startsWith(p.slice(0, -1))) return pattern
      } else if (trimmed === p || trimmed.startsWith(p + " ")) {
        return pattern
      }
    }
    return null
  }

  export interface CheckResult {
    blocked: boolean
    reason?: string
    requiresConfirmation?: boolean
    matchedPattern?: string
    profile?: Profile
    skipPermissions?: boolean
  }

  // Wrapper commands that should be unwrapped to find the actual command
  const WRAPPER_COMMANDS = new Set(['sudo', 'doas', 'env', 'command', 'nohup', 'nice', 'timeout'])
  const SUDO_OPTS_WITH_ARG = new Set(['-u', '-g', '-p', '-r', '-t', '-C', '-h', '-U', '-D', '-T'])
  const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/

  function unwrapWrapper(parts: string[]): string[] {
    if (!parts.length) return parts
    const wrapper = parts[0]?.replace(/^.*\//, '')
    if (!wrapper || !WRAPPER_COMMANDS.has(wrapper)) return parts

    let i = 1
    while (i < parts.length) {
      const token = parts[i]
      if (token === '--') {
        i++
        break
      }
      if (wrapper === 'sudo' && SUDO_OPTS_WITH_ARG.has(token)) {
        i += 2
        continue
      }
      if (token.startsWith('-')) {
        i++
        continue
      }
      if (wrapper === 'env' && ENV_ASSIGNMENT_RE.test(token)) {
        i++
        continue
      }
      break
    }
    return unwrapWrapper(parts.slice(i))
  }

  // Git subcommands that modify repository state
  const FILE_MODIFYING_GIT_SUBCOMMANDS = new Set([
    'add', 'commit', 'push', 'pull', 'merge', 'rebase', 'reset', 'checkout',
    'branch', 'tag', 'stash', 'cherry-pick', 'revert', 'am', 'apply',
    'mv', 'rm', 'clean', 'restore', 'switch',
  ])

  /**
   * Check if a command is blocked based on the effective blocklist.
   * This handles command parsing, wrapper unwrapping, and special cases like git subcommands.
   */
  function isCommandBlocked(
    command: string,
    blocklist: Set<string>
  ): { blocked: boolean; reason?: string } {
    const trimmed = command.trim()

    // Block any output redirection to file (>, >>, 2>, &>)
    if (/(?:^|[^\w])(?:\d|&)?>>?\s*[^\s&|;]+/.test(trimmed)) {
      return { blocked: true, reason: 'output redirection to file' }
    }

    // Check for pipe to tee
    if (/\|\s*tee\s+/.test(trimmed)) {
      return { blocked: true, reason: 'pipe to tee (writes to file)' }
    }

    // Parse commands (handle pipes and &&)
    const commands = trimmed.split(/\s*[|&;]\s*/).filter(Boolean)

    for (const part of commands) {
      const rawParts = part.trim().split(/\s+/)
      const parts = unwrapWrapper(rawParts)
      const cmd = parts[0]?.replace(/^.*\//, '')

      if (!cmd) continue

      // Check sed with -i flag
      if (cmd === 'sed' && (parts.includes('-i') || parts.some(p => p.startsWith('-i')))) {
        return { blocked: true, reason: 'sed with in-place edit (-i)' }
      }

      // Check git subcommands
      if (cmd === 'git') {
        const subcommand = parts[1]
        if (subcommand && FILE_MODIFYING_GIT_SUBCOMMANDS.has(subcommand)) {
          return { blocked: true, reason: `git ${subcommand} modifies repository` }
        }
        continue
      }

      // Check against blocklist
      if (blocklist.has(cmd)) {
        return { blocked: true, reason: `${cmd} is blocked by hold-mode profile` }
      }
    }

    return { blocked: false }
  }

  export async function checkCommand(
    command: string,
    options: { holdMode: boolean; skipPermissions?: boolean }
  ): Promise<CheckResult> {
    // PERFORMANCE: Check cache first
    const cacheKey = `${command}::${options.holdMode}::${options.skipPermissions ?? false}`
    const cached = checkCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CHECK_CACHE_TTL_MS) {
      return cached.result
    }

    // Skip ALL checks if skipPermissions is true (no cuffs mode)
    if (options.skipPermissions === true) {
      const result: CheckResult = {
        blocked: false,
        skipPermissions: true,
        profile: undefined
      }
      checkCache.set(cacheKey, { result, timestamp: Date.now() })
      return result
    }

    const config = await load()

    // Always check always_block first (applies in both HOLD and RELEASE modes)
    const blockedPattern = findMatchingPattern(command, config.always_block)
    if (blockedPattern) {
      const result: CheckResult = { blocked: true, reason: "command in always_block list", matchedPattern: blockedPattern, profile: config.profile }
      checkCache.set(cacheKey, { result, timestamp: Date.now() })
      return result
    }

    if (options.holdMode) {
      // Check if command is explicitly allowed in hold mode
      if (matchesPattern(command, config.hold_allow)) {
        const result: CheckResult = { blocked: false, profile: config.profile }
        checkCache.set(cacheKey, { result, timestamp: Date.now() })
        return result
      }

      // Check against profile-based blocklist (includes command parsing, git subcommands, etc.)
      const blocklist = await getEffectiveBlocklist(config.profile)
      const blockCheck = isCommandBlocked(command, blocklist)
      if (blockCheck.blocked) {
        const result: CheckResult = {
          blocked: true,
          reason: blockCheck.reason,
          profile: config.profile,
        }
        checkCache.set(cacheKey, { result, timestamp: Date.now() })
        return result
      }
    }

    // RELEASE mode - check release_confirm patterns before auto-approving
    if (!options.holdMode) {
      const confirmPattern = findMatchingPattern(command, config.release_confirm)
      if (confirmPattern) {
        const result: CheckResult = {
          blocked: false,
          requiresConfirmation: true,
          matchedPattern: confirmPattern,
          profile: config.profile,
        }
        checkCache.set(cacheKey, { result, timestamp: Date.now() })
        return result
      }
      const result: CheckResult = { blocked: false, profile: config.profile }
      checkCache.set(cacheKey, { result, timestamp: Date.now() })
      return result
    }

    const result: CheckResult = { blocked: false, profile: config.profile }
    checkCache.set(cacheKey, { result, timestamp: Date.now() })
    return result
  }

  export async function isToolAllowedInHold(
    tool: "edit" | "write" | "apply_patch" | "todowrite",
    skipPermissions?: boolean
  ): Promise<boolean> {
    // Always allow if skipPermissions is true (no cuffs mode)
    if (skipPermissions === true) {
      return true
    }

    const config = await load()
    const toolSetting = config.tools[tool]
    if (toolSetting !== undefined) return toolSetting
    return false
  }

  export async function getEffectiveBlocklist(profile: Profile): Promise<Set<string>> {
    const base = new Set([
      "rm", "mv", "cp", "mkdir", "rmdir", "touch", "chmod", "chown",
      "ln", "unlink", "install", "shred", "tee", "dd", "truncate",
      "patch", "ed", "ex", "chattr",
      "kill", "pkill", "killall", "renice", "xkill",
      "systemctl", "service", "shutdown", "reboot", "poweroff", "halt", "init",
      "loginctl", "timedatectl", "hostnamectl",
      "mount", "umount", "modprobe", "insmod", "rmmod", "sysctl",
      "ip", "ifconfig", "nmcli", "iptables", "nft", "ufw", "firewall-cmd",
    ])

    if (profile === "strict") {
      for (const cmd of STRICT_ADDITIONS) {
        base.add(cmd)
      }
    } else if (profile === "permissive") {
      for (const cmd of PERMISSIVE_REMOVALS) {
        base.delete(cmd)
      }
    }

    return base
  }
}
