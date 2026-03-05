import { Log } from "../util/log"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import z from "zod"
import { Filesystem } from "../util/filesystem"
import { ModelsDev } from "../provider/models"
import { mergeDeep, pipe, unique } from "remeda"
import { Global } from "../global"
import fs from "fs/promises"
import { lazy } from "../util/lazy"
import { NamedError } from "@zee/util/error"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import { Instance } from "../project/instance"
import { LSPServer } from "../lsp/server"
import { BunProc } from "@/bun"
import { Installation } from "@/installation"
import { ConfigMarkdown } from "./markdown"
import { constants, existsSync } from "fs"
import { Bus } from "@/bus"

export namespace Config {
  const log = Log.create({ service: "config" })
  const CONFIG_FILENAMES = ["zee.json", "zee.jsonc"] as const

  // Managed settings directory for enterprise deployments (highest priority, admin-controlled).
  // These settings override all user and project settings.
  function getManagedConfigDir(): string {
    switch (process.platform) {
      case "darwin":
        return "/Library/Application Support/zee"
      case "win32":
        return path.join(process.env.ProgramData || "C:\\ProgramData", "zee")
      default:
        return "/etc/zee"
    }
  }

  const managedConfigDir = process.env.ZEE_TEST_MANAGED_CONFIG_DIR || getManagedConfigDir()

  // Custom merge function that concatenates array fields instead of replacing them
  function mergeConfigConcatArrays(target: Info, source: Info): Info {
    const merged = mergeDeep(target, source)
    if (target.plugin && source.plugin) {
      merged.plugin = Array.from(new Set([...target.plugin, ...source.plugin]))
    }
    if (target.instructions && source.instructions) {
      merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
    }
    return merged
  }

  export const state = Instance.state(async () => {
    const auth = await Auth.all()

    // Load remote/well-known config first as the base layer (lowest precedence)
    // This allows organizations to provide default configs that users can override
    let result: Info = {}
    for (const [key, value] of Object.entries(auth)) {
      if (value.type === "wellknown") {
        process.env[value.key] = value.token
        log.debug("fetching remote config", { url: `${key}/.well-known/zee` })
        const response = await fetch(`${key}/.well-known/zee`)
        if (!response.ok) {
          throw new Error(`failed to fetch remote config from ${key}: ${response.status}`)
        }
        const wellknown = (await response.json()) as { config?: Record<string, unknown> }
        const remoteConfig = wellknown.config ?? {}
        // Add $schema to prevent load() from trying to write back to a non-existent file
        if (!remoteConfig.$schema) remoteConfig.$schema = "zee"
        result = mergeConfigConcatArrays(result, await load(JSON.stringify(remoteConfig), `${key}/.well-known/zee`))
        log.debug("loaded remote config from well-known", { url: key })
      }
    }

    // Global user config overrides remote config
    result = mergeConfigConcatArrays(result, await global())

    // Custom config path overrides global
    if (Flag.ZEE_CONFIG) {
      result = mergeConfigConcatArrays(result, await loadFile(Flag.ZEE_CONFIG))
      log.debug("loaded custom config", { path: Flag.ZEE_CONFIG })
    }

    // Project config has highest precedence (overrides global and remote)
    if (!Flag.ZEE_DISABLE_PROJECT_CONFIG) {
      for (const file of CONFIG_FILENAMES) {
        const found = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
        for (const resolved of found.toReversed()) {
          result = mergeConfigConcatArrays(result, await loadFile(resolved))
        }
      }
    }

    // Inline config content has highest precedence
    if (Flag.ZEE_CONFIG_CONTENT) {
      try {
        const parsed = JSON.parse(Flag.ZEE_CONFIG_CONTENT)
        // Use partial schema since inline config may override only some fields
        const validated = Info.partial().parse(parsed)
        result = mergeConfigConcatArrays(result, validated as Info)
        log.debug("loaded custom config from ZEE_CONFIG_CONTENT")
      } catch (error) {
        log.error("failed to parse ZEE_CONFIG_CONTENT", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    result.agent = result.agent || {}
    result.mode = result.mode || {}
    result.plugin = result.plugin || []

    const directories = []

    // Support running from any directory via launcher script that sets ZEE_ROOT.
    // Treat packaged config as the lowest-precedence defaults so user/project config can override it.
    const zeeRoot = process.env.ZEE_ROOT
    if (zeeRoot) {
      const rootConfigDir = path.join(zeeRoot, ".zee")
      if (existsSync(rootConfigDir)) {
        directories.push(rootConfigDir)
        log.debug("loading config from ZEE_ROOT", { path: rootConfigDir })
      }
    }

    directories.push(
      Global.Path.config,
      ...(!Flag.ZEE_DISABLE_PROJECT_CONFIG
        ? await Array.fromAsync(
            Filesystem.up({
              targets: [".zee"],
              start: Instance.directory,
              stop: Instance.worktree,
            }),
          )
        : []),
    )

    if (Flag.ZEE_CONFIG_DIR) {
      directories.push(Flag.ZEE_CONFIG_DIR)
      log.debug("loading config from ZEE_CONFIG_DIR", { path: Flag.ZEE_CONFIG_DIR })
    }

    for (const dir of unique(directories)) {
      const safeDir = Filesystem.sanitizePath(dir)
      if (safeDir.endsWith(".zee") || safeDir === Flag.ZEE_CONFIG_DIR) {
        for (const file of CONFIG_FILENAMES) {
          log.debug(`loading config from ${path.join(safeDir, file)}`)
          result = mergeConfigConcatArrays(result, await loadFile(path.join(safeDir, file)))
          // to satisfy the type checker
          result.agent ??= {}
          result.mode ??= {}
          result.plugin ??= []
        }
      }

      const exists = existsSync(path.join(safeDir, "node_modules"))
      const installing = installDependencies(safeDir)
      if (!exists) await installing

      result.command = mergeDeep(result.command ?? {}, await loadCommand(safeDir))
      result.agent = mergeDeep(result.agent, await loadAgent(safeDir))
      result.agent = mergeDeep(result.agent, await loadMode(safeDir))
      result.plugin.push(...(await loadPlugin(safeDir)))
    }

    // Load managed config files last (highest precedence) - enterprise admin-controlled.
    // Kept separate from directories to avoid writes (plugin install) to system directories
    // requiring elevated permissions.
    const safeManagedConfigDir = Filesystem.sanitizePath(managedConfigDir)
    if (existsSync(safeManagedConfigDir)) {
      for (const file of CONFIG_FILENAMES) {
        result = mergeConfigConcatArrays(result, await loadFile(path.join(safeManagedConfigDir, file)))
        // to satisfy the type checker
        result.agent ??= {}
        result.mode ??= {}
        result.plugin ??= []
      }
    }

    if (Flag.ZEE_PERMISSION) {
      try {
        const parsed = JSON.parse(Flag.ZEE_PERMISSION)
        const validated = Permission.parse(parsed)
        result.permission = mergeDeep(result.permission ?? {}, validated)
      } catch (error) {
        log.error("failed to parse ZEE_PERMISSION", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (!result.username) result.username = os.userInfo().username

    if (!result.keybinds) result.keybinds = Info.shape.keybinds.parse({})
    if (!result.tui) result.tui = Info.shape.tui.parse({})

    result.plugin = deduplicatePlugins(result.plugin ?? [])
    ModelsDev.configure({
      url: result.models?.url,
      path: result.models?.path,
    })

    return {
      config: result,
      directories,
    }
  })

  async function isWritable(dir: string) {
    try {
      await fs.access(dir, constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  async function isPortableLocalPlugin(localPluginPkgPath: string) {
    const raw = await fs.readFile(localPluginPkgPath, "utf-8").catch(() => "")
    if (!raw) return false
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }

    const specs = [
      ...Object.values(parsed.dependencies ?? {}),
      ...Object.values(parsed.peerDependencies ?? {}),
      ...Object.values(parsed.optionalDependencies ?? {}),
    ]
    return !specs.some((spec) => /^(workspace:|catalog:)/.test(spec))
  }

  export async function installDependencies(dir: string) {
    // Benchmarks and certain automation should never mutate user config directories.
    // This env var is intentionally read at call time (not via Flag) to avoid stale values
    // when the process sets it after module import.
    const disableInstall = (() => {
      const v = process.env.ZEE_DISABLE_CONFIG_DEPENDENCY_INSTALL?.toLowerCase()
      return v === "true" || v === "1"
    })()
    if (disableInstall) {
      log.debug("dependency install disabled", { dir })
      return
    }

    const writable = await isWritable(dir)
    if (!writable) {
      log.debug("config dir is not writable, skipping dependency install", { dir })
      return
    }

    const pkg = path.join(dir, "package.json")

    if (!(await Bun.file(pkg).exists())) {
      await Bun.write(pkg, "{}")
    }

    const gitignore = path.join(dir, ".gitignore")
    const hasGitIgnore = await Bun.file(gitignore).exists()
    if (!hasGitIgnore) await Bun.write(gitignore, ["node_modules", "package.json", "bun.lock", ".gitignore"].join("\n"))

    const pluginVersion = Installation.isLocal() || Installation.isPreview() ? "latest" : Installation.VERSION
    const localPluginDir = path.join(Global.Path.source, "packages", "plugin")
    const localPluginSpecifier = `file:${localPluginDir}`
    const localPluginPkg = path.join(localPluginDir, "package.json")
    const localPluginAvailable = await Filesystem.exists(localPluginPkg)
    const localPluginPortable = localPluginAvailable ? await isPortableLocalPlugin(localPluginPkg) : false
    const pluginSpecifier = localPluginAvailable
      ? localPluginPortable
        ? localPluginSpecifier
        : undefined
      : "@zee/plugin@" + pluginVersion

    if (pluginSpecifier) {
      await BunProc.run(["add", pluginSpecifier, "--exact"], {
        cwd: dir,
      }).catch((err) => {
        log.debug("failed to add plugin package", { error: String(err), dir })
      })
    } else {
      log.debug("skipping plugin package add; local plugin manifest is not portable outside workspace", {
        dir,
        localPluginPkg,
      })
    }

    // Install any additional dependencies defined in the package.json
    // This allows local plugins and custom tools to use external packages
    await BunProc.run(["install"], { cwd: dir }).catch((err) => {
      log.debug("failed to install plugin dependencies", { error: String(err), dir })
    })
  }

  function rel(item: string, patterns: string[]) {
    for (const pattern of patterns) {
      const index = item.indexOf(pattern)
      if (index === -1) continue
      return item.slice(index + pattern.length)
    }
  }

  function trim(file: string) {
    const ext = path.extname(file)
    return ext.length ? file.slice(0, -ext.length) : file
  }

  const COMMAND_GLOB = new Bun.Glob("{command,commands}/**/*.md")
  async function loadCommand(dir: string) {
    const result: Record<string, Command> = {}
    for await (const item of COMMAND_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse command ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load command", { command: item, err })
        return undefined
      })
      if (!md) continue

      const patterns = ["/.zee/command/", "/.zee/commands/", "/command/", "/commands/"]
      const file = rel(item, patterns) ?? path.basename(item)
      const name = trim(file)

      const config = {
        name,
        ...md.data,
        template: md.content.trim(),
      }
      const parsed = Command.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  const AGENT_GLOB = new Bun.Glob("{agent,agents}/**/*.md")
  async function loadAgent(dir: string) {
    const result: Record<string, Agent> = {}

    for await (const item of AGENT_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse agent ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load agent", { agent: item, err })
        return undefined
      })
      if (!md) continue

      const patterns = ["/.zee/agent/", "/.zee/agents/", "/agent/", "/agents/"]
      const file = rel(item, patterns) ?? path.basename(item)
      const agentName = trim(file)

      const config = {
        name: agentName,
        ...md.data,
        prompt: md.content.trim(),
      }
      // Log at info level for persona debugging visibility
      log.info("loading agent from markdown", {
        name: agentName,
        file: item,
        promptLength: config.prompt?.length ?? 0,
        promptPreview: config.prompt?.slice(0, 100) ?? "(empty)",
      })
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = parsed.data
        continue
      }
      throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
    }
    return result
  }

  const MODE_GLOB = new Bun.Glob("{mode,modes}/*.md")
  async function loadMode(dir: string) {
    const result: Record<string, Agent> = {}
    for await (const item of MODE_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      const md = await ConfigMarkdown.parse(item).catch(async (err) => {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse mode ${item}`
        const { Session } = await import("@/session")
        Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load mode", { mode: item, err })
        return undefined
      })
      if (!md) continue

      const config = {
        name: path.basename(item, ".md"),
        ...md.data,
        prompt: md.content.trim(),
      }
      const parsed = Agent.safeParse(config)
      if (parsed.success) {
        result[config.name] = {
          ...parsed.data,
          mode: "primary" as const,
        }
        continue
      }
    }
    return result
  }

  const PLUGIN_GLOB = new Bun.Glob("{plugin,plugins}/*.{ts,js}")
  async function loadPlugin(dir: string) {
    const plugins: string[] = []

    for await (const item of PLUGIN_GLOB.scan({
      absolute: true,
      followSymlinks: true,
      dot: true,
      cwd: dir,
    })) {
      plugins.push(pathToFileURL(item).href)
    }
    return plugins
  }

  /**
   * Extracts a canonical plugin name from a plugin specifier.
   * - For file:// URLs: extracts filename without extension
   * - For npm packages: extracts package name without version
   *
   * @example
   * getPluginName("file:///path/to/plugin/foo.js") // "foo"
   * getPluginName("oh-my-opencode@2.4.3") // "oh-my-opencode"
   * getPluginName("@scope/pkg@1.0.0") // "@scope/pkg"
   */
  export function getPluginName(plugin: string): string {
    if (plugin.startsWith("file://")) {
      return path.parse(new URL(plugin).pathname).name
    }
    const lastAt = plugin.lastIndexOf("@")
    if (lastAt > 0) {
      return plugin.substring(0, lastAt)
    }
    return plugin
  }

  /**
   * Deduplicates plugins by name, with later entries (higher priority) winning.
   * Priority order (highest to lowest):
   * 1. Local plugin/ directory
   * 2. Local zee.jsonc
   * 3. Global plugin/ directory
   * 4. Global zee.jsonc
   *
   * Since plugins are added in low-to-high priority order,
   * we reverse, deduplicate (keeping first occurrence), then restore order.
   */
  export function deduplicatePlugins(plugins: string[]): string[] {
    // seenNames: canonical plugin names for duplicate detection
    // e.g., "oh-my-opencode", "@scope/pkg"
    const seenNames = new Set<string>()

    // uniqueSpecifiers: full plugin specifiers to return
    // e.g., "oh-my-opencode@2.4.3", "file:///path/to/plugin.js"
    const uniqueSpecifiers: string[] = []

    for (const specifier of plugins.toReversed()) {
      const name = getPluginName(specifier)
      if (!seenNames.has(name)) {
        seenNames.add(name)
        uniqueSpecifiers.push(specifier)
      }
    }

    return uniqueSpecifiers.toReversed()
  }

  export const McpLocal = z
    .object({
      type: z.literal("local").describe("Type of MCP server connection"),
      command: z.string().array().describe("Command and arguments to run the MCP server"),
      environment: z
        .record(z.string(), z.string())
        .optional()
        .describe("Environment variables to set when running the MCP server"),
      enabled: z.boolean().optional().describe("Reserved for compatibility; MCP servers are always enabled"),
      timeout: z.number().int().positive().optional().describe("Timeout in ms for MCP server requests."),
      lifecycle: z
        .enum(["eager", "lazy", "keep-alive"])
        .optional()
        .describe(
          "Connection lifecycle. eager=connect at startup, lazy=connect on first use, keep-alive=stay connected.",
        ),
      idleTimeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Idle timeout in minutes for lazy MCP servers before automatic disconnect."),
      directTools: z
        .union([z.boolean(), z.array(z.string())])
        .optional()
        .describe(
          "Control direct tool exposure. true=all tools, false=proxy only, string[]=allowlisted tool names only.",
        ),
    })
    .strict()
    .meta({
      ref: "McpLocalConfig",
    })

  export const McpOAuth = z
    .object({
      clientId: z
        .string()
        .optional()
        .describe("OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted."),
      clientSecret: z.string().optional().describe("OAuth client secret (if required by the authorization server)"),
      scope: z.string().optional().describe("OAuth scopes to request during authorization"),
    })
    .strict()
    .meta({
      ref: "McpOAuthConfig",
    })
  export type McpOAuth = z.infer<typeof McpOAuth>

  export const McpRemote = z
    .object({
      type: z.literal("remote").describe("Type of MCP server connection"),
      url: z.string().describe("URL of the remote MCP server"),
      enabled: z.boolean().optional().describe("Reserved for compatibility; MCP servers are always enabled"),
      headers: z.record(z.string(), z.string()).optional().describe("Headers to send with the request"),
      async: z
        .boolean()
        .optional()
        .describe("Run MCP tools asynchronously (returns job id; use <server>_job_poll to retrieve results)."),
      oauth: z
        .union([McpOAuth, z.literal(false)])
        .optional()
        .describe(
          "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
        ),
      timeout: z.number().int().positive().optional().describe("Timeout in ms for MCP server requests."),
      lifecycle: z
        .enum(["eager", "lazy", "keep-alive"])
        .optional()
        .describe(
          "Connection lifecycle. eager=connect at startup, lazy=connect on first use, keep-alive=stay connected.",
        ),
      idleTimeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Idle timeout in minutes for lazy MCP servers before automatic disconnect."),
      directTools: z
        .union([z.boolean(), z.array(z.string())])
        .optional()
        .describe(
          "Control direct tool exposure. true=all tools, false=proxy only, string[]=allowlisted tool names only.",
        ),
    })
    .strict()
    .meta({
      ref: "McpRemoteConfig",
    })

  export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
  export type Mcp = z.infer<typeof Mcp>

  export const PermissionAction = z.enum(["ask", "allow", "deny"]).meta({
    ref: "PermissionActionConfig",
  })
  export type PermissionAction = z.infer<typeof PermissionAction>

  export const PermissionObject = z.record(z.string(), PermissionAction).meta({
    ref: "PermissionObjectConfig",
  })
  export type PermissionObject = z.infer<typeof PermissionObject>

  export const PermissionRule = z.union([PermissionAction, PermissionObject]).meta({
    ref: "PermissionRuleConfig",
  })
  export type PermissionRule = z.infer<typeof PermissionRule>

  // Capture original key order before zod reorders, then rebuild in original order
  const permissionPreprocess = (val: unknown) => {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      return { __originalKeys: Object.keys(val), ...val }
    }
    return val
  }

  const permissionTransform = (x: unknown): Record<string, PermissionRule> => {
    if (typeof x === "string") return { "*": x as PermissionAction }
    const obj = x as { __originalKeys?: string[] } & Record<string, unknown>
    const { __originalKeys, ...rest } = obj
    if (!__originalKeys) return rest as Record<string, PermissionRule>
    const result: Record<string, PermissionRule> = {}
    for (const key of __originalKeys) {
      if (key in rest) result[key] = rest[key] as PermissionRule
    }
    return result
  }

  export const Permission = z
    .preprocess(
      permissionPreprocess,
      z
        .object({
          __originalKeys: z.string().array().optional(),
          read: PermissionRule.optional(),
          edit: PermissionRule.optional(),
          glob: PermissionRule.optional(),
          grep: PermissionRule.optional(),
          list: PermissionRule.optional(),
          bash: PermissionRule.optional(),
          task: PermissionRule.optional(),
          external_directory: PermissionRule.optional(),
          todowrite: PermissionAction.optional(),
          todoread: PermissionAction.optional(),
          question: PermissionAction.optional(),
          skill: PermissionRule.optional(),
          webfetch: PermissionAction.optional(),
          websearch: PermissionAction.optional(),
          codesearch: PermissionAction.optional(),
          lsp: PermissionRule.optional(),
          doom_loop: PermissionAction.optional(),
        })
        .catchall(PermissionRule)
        .or(PermissionAction),
    )
    .transform(permissionTransform)
    .meta({
      ref: "PermissionConfig",
    })
  export type Permission = z.infer<typeof Permission>

  export const Command = z.object({
    template: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    subtask: z.boolean().optional(),
  })
  export type Command = z.infer<typeof Command>

  export const SkillEntry = z.object({
    enabled: z.boolean().optional().describe("Reserved for compatibility; skills are always enabled"),
    apiKey: z.string().optional().describe("API key mapped to the skill's primaryEnv variable"),
    env: z.record(z.string(), z.string()).optional().describe("Environment variable overrides for this skill"),
  })
  export type SkillEntry = z.infer<typeof SkillEntry>

  export const Skills = z.object({
    paths: z.array(z.string()).optional().describe("Additional paths to skill folders"),
    entries: z.record(z.string(), SkillEntry).optional().describe("Per-skill configuration keyed by skill name"),
  })
  export type Skills = z.infer<typeof Skills>

  export const Agent = z
    .object({
      model: z.string().optional(),
      fallback: z.string().optional(),
      temperature: z.number().optional(),
      top_p: z.number().optional(),
      top_k: z.number().optional(),
      prompt: z.string().optional(),
      tools: z.record(z.string(), z.boolean()).optional().describe("@deprecated Use 'permission' field instead"),
      disable: z.boolean().optional(),
      description: z.string().optional().describe("Description of when to use the agent"),
      mode: z.enum(["subagent", "primary", "all"]).optional(),
      hidden: z
        .boolean()
        .optional()
        .describe("Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)"),
      options: z.record(z.string(), z.any()).optional(),
      color: z
        .union([
          z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format"),
          z.enum(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
        ])
        .optional()
        .describe(
          "Hex color code (e.g., #FF5733) or theme color name (primary, secondary, accent, success, warning, error, info)",
        ),
      steps: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of agentic iterations before forcing text-only response"),
      maxSteps: z.number().int().positive().optional().describe("@deprecated Use 'steps' field instead."),
      permission: Permission.optional(),
      // Additional sampling parameters
      frequency_penalty: z
        .number()
        .min(-2)
        .max(2)
        .optional()
        .describe("Frequency penalty for repetition control (-2 to 2)"),
      presence_penalty: z
        .number()
        .min(-2)
        .max(2)
        .optional()
        .describe("Presence penalty for diversity control (-2 to 2)"),
      seed: z.number().int().optional().describe("Seed for reproducible outputs"),
      min_p: z.number().min(0).max(1).optional().describe("Min-p sampling threshold (0 to 1)"),
      // Persona-specific fields (from AgentPersonaConfig)
      systemPromptAdditions: z
        .string()
        .optional()
        .describe("Additional system prompt content to inject for this agent/persona"),
      knowledge: z.array(z.string()).optional().describe("File paths to knowledge files to include in context"),
      mcpServers: z.array(z.string()).optional().describe("MCP server names to auto-start for this agent"),
    })
    .catchall(z.any())
    .transform((agent, _ctx) => {
      const knownKeys = new Set([
        "name",
        "model",
        "fallback",
        "prompt",
        "description",
        "temperature",
        "top_p",
        "top_k",
        "mode",
        "hidden",
        "color",
        "steps",
        "options",
        "permission",
        "disable",
        // Additional sampling parameters
        "frequency_penalty",
        "presence_penalty",
        "seed",
        "min_p",
        // Persona-specific fields
        "systemPromptAdditions",
        "knowledge",
        "mcpServers",
        // Metadata fields (not passed to provider)
        "theme",
        "skill",
      ])

      // Extract unknown properties into options
      const options: Record<string, unknown> = { ...agent.options }
      for (const [key, value] of Object.entries(agent)) {
        if (!knownKeys.has(key)) options[key] = value
      }

      return { ...agent, options } as typeof agent & {
        options?: Record<string, unknown>
      }
    })
    .meta({
      ref: "AgentConfig",
    })
  export type Agent = z.infer<typeof Agent>

  export const Keybinds = z
    .object({
      leader: z.string().optional().default("space").describe("Leader key for keybind combinations"),
      app_exit: z.string().optional().default("ctrl+c,<leader>q").describe("Exit the application"),
      editor_open: z.string().optional().default("<leader>e").describe("Open external editor"),
      theme_list: z.string().optional().default("<leader>shift+t").describe("List available themes"),
      sidebar_toggle: z.string().optional().default("<leader>b").describe("Toggle sidebar"),
      status_view: z.string().optional().default("<leader>s").describe("View status"),
      help_view: z.string().optional().default("<leader>?").describe("View help"),
      legend_view: z.string().optional().default("<leader>shift+?").describe("View legend"),
      session_export: z.string().optional().default("<leader>x").describe("Export session to editor"),
      session_new: z.string().optional().default("<leader>n").describe("Create a new session"),
      session_list: z.string().optional().default("<leader>l").describe("List all sessions"),
      session_timeline: z.string().optional().default("<leader>g").describe("Show session timeline"),
      session_fork: z.string().optional().default("none").describe("Fork session from message"),
      session_rename: z.string().optional().default("<leader>shift+r").describe("Rename session"),
      session_delete: z.string().optional().default("<leader>d").describe("Delete session"),
      stash_delete: z.string().optional().default("<leader>shift+x").describe("Delete stash entry"),
      model_provider_list: z.string().optional().default("<leader>p").describe("Open provider list from model dialog"),
      session_delegate: z
        .string()
        .optional()
        .default("<leader>shift+d")
        .describe("Deprecated (persona delegation removed; Zee is the only active persona)"),
      session_interrupt: z.string().optional().default("escape").describe("Interrupt current session"),
      session_compact: z.string().optional().default("<leader>shift+c").describe("Compact the session"),
      messages_page_up: z.string().optional().default("pageup,ctrl+alt+b").describe("Scroll messages up by one page"),
      messages_page_down: z
        .string()
        .optional()
        .default("pagedown,ctrl+alt+f")
        .describe("Scroll messages down by one page"),
      messages_line_up: z.string().optional().default("ctrl+alt+y").describe("Scroll messages up by one line"),
      messages_line_down: z.string().optional().default("ctrl+alt+e").describe("Scroll messages down by one line"),
      messages_half_page_up: z.string().optional().default("ctrl+alt+u").describe("Scroll messages up by half page"),
      messages_half_page_down: z
        .string()
        .optional()
        .default("ctrl+alt+d")
        .describe("Scroll messages down by half page"),
      messages_first: z.string().optional().default("home").describe("Navigate to first message"),
      messages_last: z.string().optional().default("shift+g,end").describe("Navigate to last message"),
      messages_next: z.string().optional().default("<leader>]").describe("Navigate to next message"),
      messages_previous: z.string().optional().default("<leader>[").describe("Navigate to previous message"),
      messages_last_user: z.string().optional().default("<leader>j").describe("Jump to last user message"),
      messages_copy: z.string().optional().default("<leader>y").describe("Copy message"),
      messages_undo: z.string().optional().default("<leader>u").describe("Undo message"),
      messages_redo: z.string().optional().default("<leader>r").describe("Redo message"),
      messages_toggle_conceal: z
        .string()
        .optional()
        .default("<leader>/")
        .describe("Toggle code block concealment in messages"),
      messages_toggle_thinking: z
        .string()
        .optional()
        .default("<leader>i")
        .describe("Toggle thinking blocks visibility"),
      tool_details: z.string().optional().default("none").describe("Toggle tool details visibility"),
      messages_toggle_scrollbar: z
        .string()
        .optional()
        .default("<leader>shift+s")
        .describe("Toggle session scrollbar visibility"),
      model_list: z.string().optional().default("<leader>m").describe("List available models"),
      model_fallback_toggle: z.string().optional().default("f3").describe("Toggle between primary and fallback model"),
      model_favorite_toggle: z.string().optional().default("ctrl+f").describe("Toggle current model as favorite"),
      model_cycle_favorite: z.string().optional().default("f2").describe("Cycle to next favorite model"),
      model_cycle_favorite_reverse: z
        .string()
        .optional()
        .default("shift+f2")
        .describe("Cycle to previous favorite model"),
      command_list: z.string().optional().default("<leader>c").describe("List available commands"),
      agent_list: z
        .string()
        .optional()
        .default("<leader>a")
        .describe("Deprecated (agent switching removed; Zee is the only active persona)"),
      agent_cycle: z.string().optional().default("tab").describe("Deprecated (agent switching removed)"),
      agent_cycle_reverse: z.string().optional().default("none").describe("Deprecated (agent switching removed)"),
      mode_toggle: z.string().optional().default("<leader>h").describe("Toggle plan/accept mode"),
      mode_cycle: z.string().optional().default("shift+tab").describe("Cycle mode (plan/accept/bypass)."),
      variant_cycle: z.string().optional().default("<leader>v").describe("Cycle model variants"),
      input_clear: z.string().optional().default("ctrl+c").describe("Clear input field"),
      input_paste: z.string().optional().default("ctrl+v").describe("Paste from clipboard"),
      input_submit: z.string().optional().default("return").describe("Submit input"),
      input_dictation_toggle: z.string().optional().default("<leader>t").describe("Toggle dictation recording"),
      input_dictation_hold: z
        .string()
        .optional()
        .default("alt")
        .describe("Hold to record, release to stop (requires kitty/ghostty/foot terminal). Set to 'alt' to enable."),
      grammar_quickfix: z.string().optional().default("<leader>.").describe("Quick-fix grammar error at cursor"),
      grammar_menu: z.string().optional().default("<leader>shift+g").describe("Open grammar check menu"),
      input_newline: z
        .string()
        .optional()
        .default("shift+return,ctrl+return,alt+return,ctrl+j")
        .describe("Insert newline in input"),
      input_move_left: z.string().optional().default("left,ctrl+b").describe("Move cursor left in input"),
      input_move_right: z.string().optional().default("right,ctrl+f").describe("Move cursor right in input"),
      input_move_up: z.string().optional().default("up").describe("Move cursor up in input"),
      input_move_down: z.string().optional().default("down").describe("Move cursor down in input"),
      input_select_left: z.string().optional().default("shift+left").describe("Select left in input"),
      input_select_right: z.string().optional().default("shift+right").describe("Select right in input"),
      input_select_up: z.string().optional().default("shift+up").describe("Select up in input"),
      input_select_down: z.string().optional().default("shift+down").describe("Select down in input"),
      input_line_home: z.string().optional().default("ctrl+a").describe("Move to start of line in input"),
      input_line_end: z.string().optional().default("ctrl+e").describe("Move to end of line in input"),
      input_select_line_home: z
        .string()
        .optional()
        .default("ctrl+shift+a")
        .describe("Select to start of line in input"),
      input_select_line_end: z.string().optional().default("ctrl+shift+e").describe("Select to end of line in input"),
      input_visual_line_home: z.string().optional().default("alt+a").describe("Move to start of visual line in input"),
      input_visual_line_end: z.string().optional().default("alt+e").describe("Move to end of visual line in input"),
      input_select_visual_line_home: z
        .string()
        .optional()
        .default("alt+shift+a")
        .describe("Select to start of visual line in input"),
      input_select_visual_line_end: z
        .string()
        .optional()
        .default("alt+shift+e")
        .describe("Select to end of visual line in input"),
      input_buffer_home: z.string().optional().default("home").describe("Move to start of buffer in input"),
      input_buffer_end: z.string().optional().default("end").describe("Move to end of buffer in input"),
      input_select_buffer_home: z
        .string()
        .optional()
        .default("shift+home")
        .describe("Select to start of buffer in input"),
      input_select_buffer_end: z.string().optional().default("shift+end").describe("Select to end of buffer in input"),
      input_delete_line: z.string().optional().default("ctrl+shift+d").describe("Delete line in input"),
      input_delete_to_line_end: z.string().optional().default("ctrl+k").describe("Delete to end of line in input"),
      input_delete_to_line_start: z.string().optional().default("ctrl+u").describe("Delete to start of line in input"),
      input_backspace: z.string().optional().default("backspace,shift+backspace").describe("Backspace in input"),
      input_delete: z.string().optional().default("ctrl+d,delete,shift+delete").describe("Delete character in input"),
      input_undo: z.string().optional().default("ctrl+-,super+z").describe("Undo in input"),
      input_redo: z.string().optional().default("ctrl+.,super+shift+z").describe("Redo in input"),
      input_word_forward: z
        .string()
        .optional()
        .default("alt+f,alt+right,ctrl+right")
        .describe("Move word forward in input"),
      input_word_backward: z
        .string()
        .optional()
        .default("alt+b,alt+left,ctrl+left")
        .describe("Move word backward in input"),
      input_select_word_forward: z
        .string()
        .optional()
        .default("alt+shift+f,alt+shift+right")
        .describe("Select word forward in input"),
      input_select_word_backward: z
        .string()
        .optional()
        .default("alt+shift+b,alt+shift+left")
        .describe("Select word backward in input"),
      input_delete_word_forward: z
        .string()
        .optional()
        .default("alt+d,alt+delete,ctrl+delete")
        .describe("Delete word forward in input"),
      input_delete_word_backward: z
        .string()
        .optional()
        .default("ctrl+w,ctrl+backspace,alt+backspace")
        .describe("Delete word backward in input"),
      history_previous: z.string().optional().default("up").describe("Previous history item"),
      history_next: z.string().optional().default("down").describe("Next history item"),
      session_child_cycle: z.string().optional().default("<leader>right").describe("Next child session"),
      session_child_cycle_reverse: z.string().optional().default("<leader>left").describe("Previous child session"),
      session_parent: z.string().optional().default("<leader>up").describe("Go to parent session"),
      tips_toggle: z.string().optional().default("<leader>?").describe("Toggle tips on home screen"),
      // Vim mode keybinds
      vim_normal_mode: z.string().optional().default("escape").describe("Enter vim normal mode from insert mode"),
      vim_insert_mode: z.string().optional().default("i").describe("Enter vim insert mode"),
      vim_insert_append: z.string().optional().default("a").describe("Enter insert mode after cursor"),
      vim_insert_line_start: z.string().optional().default("shift+i").describe("Enter insert mode at line start"),
      vim_insert_line_end: z.string().optional().default("shift+a").describe("Enter insert mode at line end"),
      vim_insert_below: z.string().optional().default("o").describe("Insert new line below and enter insert mode"),
      vim_insert_above: z
        .string()
        .optional()
        .default("shift+o")
        .describe("Insert new line above and enter insert mode"),
    })
    .strict()
    .meta({
      ref: "KeybindsConfig",
    })

  export const TUI = z.object({
    scroll_speed: z
      .number()
      .min(1)
      .optional()
      .default(3)
      .describe("TUI scroll speed multiplier (ignored when scroll acceleration is enabled)"),
    scroll_acceleration: z
      .object({
        enabled: z.boolean().optional().default(false).describe("Enable scroll acceleration"),
      })
      .optional()
      .default({ enabled: false })
      .describe("Scroll acceleration settings"),
    diff_style: z
      .enum(["auto", "stacked"])
      .optional()
      .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
    dictation: z
      .object({
        enabled: z
          .boolean()
          .optional()
          .describe("Enable dictation (requires Wispr Flow API key via zee auth login wisprflow)"),
        language: z.string().optional().default("en-US").describe("Primary language (BCP-47 code)"),
        alternative_languages: z
          .array(z.string())
          .optional()
          .default(["pt-BR", "es-ES", "de-DE"])
          .describe("Alternative languages for auto-detection"),
        sample_rate: z.number().int().positive().optional().default(16000).describe("Audio sample rate"),
        max_duration: z
          .number()
          .int()
          .positive()
          .optional()
          .default(30)
          .describe("Maximum duration (seconds) to send for transcription"),
        auto_submit: z.boolean().optional().default(false).describe("Auto-submit after dictation"),
        record_command: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe("Override dictation recording command"),
      })
      .optional()
      .describe("Dictation settings (uses Wispr Flow)"),
    vim: z
      .object({
        enabled: z.boolean().optional().default(true).describe("Enable vim normal/insert modes"),
        start_in_insert: z.boolean().optional().default(false).describe("Start in insert mode instead of normal mode"),
      })
      .optional()
      .describe("Vim mode settings for the input prompt"),
    kitty_keyboard: z
      .boolean()
      .optional()
      .default(true)
      .describe("Enable Kitty keyboard protocol. Disable if dead key composition (accented characters) doesn't work."),
  })

  /**
   * mDNS configuration - supports both boolean shorthand and detailed object.
   * Security note: mDNS broadcasts can disclose operational details on the network.
   * Based on Zee commit a1f9825d63 (mDNS information disclosure fix).
   */
  export const MdnsConfig = z
    .object({
      enabled: z.boolean().optional().default(true).describe("Enable mDNS service discovery"),
      minimal: z
        .boolean()
        .optional()
        .default(false)
        .describe("Minimal broadcast mode - only advertise service type, not detailed metadata"),
    })
    .strict()
    .describe("mDNS service discovery configuration")

  export const Server = z
    .object({
      port: z.number().int().positive().optional().describe("Port to listen on"),
      hostname: z.string().optional().describe("Hostname to listen on"),
      mdns: z
        .union([z.boolean(), MdnsConfig])
        .optional()
        .describe("Enable mDNS service discovery (boolean or detailed config)"),
      mdnsDomain: z.string().optional().describe("Custom domain name for mDNS service (default: zee.local)"),
      cors: z.array(z.string()).optional().describe("Additional domains to allow for CORS"),
      allowedDirectories: z
        .array(z.string())
        .optional()
        .describe(
          "Allowlist of directories that can be selected via ?directory=... or x-zee-directory in server mode. If omitted, non-loopback binds default to the daemon CWD only.",
        ),
      allowGlobalDirectory: z
        .boolean()
        .optional()
        .describe("Allow using filesystem roots (/, C:\\\\) as the instance directory (dangerous)"),
      maxInstances: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Maximum number of cached instance directories allowed in server mode. Helps bound resource usage when ?directory=... is used.",
        ),
    })
    .strict()
    .meta({
      ref: "ServerConfig",
    })

  export const GatewayControlUiAuth = z
    .object({
      required: z.boolean().optional().default(true).describe("Require authentication for Control UI endpoints"),
      mode: z
        .enum(["token", "password", "none"])
        .optional()
        .default("token")
        .describe("Control UI auth mode; `none` is dangerous break-glass mode"),
      allowPasswordOnly: z.boolean().optional().default(false).describe("Dangerous: allow password-only Control UI auth"),
      allowInsecureHttp: z
        .boolean()
        .optional()
        .default(false)
        .describe("Dangerous: allow Control UI auth over insecure HTTP"),
      breakGlassAck: z.string().optional().describe("Break-glass acknowledgement string for dangerous auth downgrades"),
    })
    .strict()
    .meta({
      ref: "GatewayControlUiAuthConfig",
    })

  export const GatewayControlUi = z
    .object({
      auth: GatewayControlUiAuth.optional().describe("Control UI authentication and downgrade guardrails"),
      trustedOrigins: z
        .array(z.string())
        .optional()
        .describe("Allowlist of trusted browser origins for Control UI"),
    })
    .strict()
    .meta({
      ref: "GatewayControlUiConfig",
    })

  export const GatewayChannelActionPack = z
    .object({
      enabled: z.boolean().optional().default(true).describe("Enable this channel action pack"),
      messageActions: z.boolean().optional().default(true).describe("Enable message actions for the channel"),
      moderationActions: z
        .boolean()
        .optional()
        .default(false)
        .describe("Enable moderation-safe actions for the channel"),
      metadataActions: z.boolean().optional().default(true).describe("Enable metadata/status actions for the channel"),
    })
    .strict()
    .meta({
      ref: "GatewayChannelActionPackConfig",
    })

  export const Gateway = z
    .object({
      controlUi: GatewayControlUi.optional().describe("Control UI security settings"),
      actionPacks: z
        .object({
          telegram: GatewayChannelActionPack.optional(),
        })
        .catchall(GatewayChannelActionPack)
        .optional()
        .describe("Per-channel action pack policy controls"),
      authRateLimit: z
        .object({
          enabled: z.boolean().optional(),
          windowMs: z.number().int().positive().optional(),
          maxAttemptsPerIp: z.number().int().positive().optional(),
          maxAttemptsPerToken: z.number().int().positive().optional(),
          lockoutMs: z.number().int().positive().optional(),
        })
        .optional()
        .describe("Gateway auth rate limiting configuration"),
    })
    .passthrough()
    .meta({
      ref: "GatewayConfig",
    })

  export const Daemon = z
    .object({
      enabled: z.boolean().optional().default(false).describe("Enable daemon mode"),
      systemd_only: z
        .boolean()
        .optional()
        .default(false)
        .describe("Disallow TUI daemon spawn; require systemd-managed daemon or --no-daemon"),
      session: z
        .object({
          persistence: z.boolean().optional().default(true).describe("Enable session persistence"),
          checkpoint_interval: z
            .number()
            .int()
            .positive()
            .optional()
            .default(300)
            .describe("Checkpoint interval in seconds"),
          recovery: z.boolean().optional().default(true).describe("Enable crash recovery"),
        })
        .optional()
        .describe("Session management configuration"),
      todo: z
        .object({
          auto_continue: z
            .boolean()
            .optional()
            .default(true)
            .describe("Automatically continue incomplete todos on session restore"),
          notify_on_incomplete: z
            .boolean()
            .optional()
            .default(true)
            .describe("Send notifications for incomplete todos"),
        })
        .optional()
        .describe("Todo continuation configuration"),
    })
    .strict()
    .meta({
      ref: "DaemonConfig",
    })

  export const Flux = z
    .object({
      enabled: z.boolean().optional().describe("Enable flux event recording"),
      retentionHours: z.number().int().positive().optional().describe("Flux event retention period in hours"),
      redaction: z
        .enum(["strict", "balanced", "debug"])
        .optional()
        .describe("Redaction policy for flux metadata/payloads"),
      maxEvents: z.number().int().positive().optional().describe("Maximum number of flux events to retain"),
      maxEventsPerTrace: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of flux events kept per trace"),
      logMirror: z.boolean().optional().describe("Mirror recorded flux events into structured logs"),
    })
    .strict()
    .meta({
      ref: "FluxConfig",
    })

  export const Layout = z.enum(["auto", "stretch"]).meta({
    ref: "LayoutConfig",
  })
  export type Layout = z.infer<typeof Layout>

  export const Grammar = z
    .object({
      provider: z.literal("languagetool").describe("Grammar checking provider"),
    })
    .meta({
      ref: "GrammarConfig",
    })
  export type Grammar = z.infer<typeof Grammar>

  export const Provider = ModelsDev.Provider.partial()
    .extend({
      whitelist: z.array(z.string()).optional(),
      blacklist: z.array(z.string()).optional(),
      models: z
        .record(
          z.string(),
          ModelsDev.Model.partial().extend({
            variants: z
              .record(
                z.string(),
                z
                  .object({
                    disabled: z.boolean().optional().describe("Disable this variant for the model"),
                  })
                  .catchall(z.any()),
              )
              .optional()
              .describe("Variant-specific configuration"),
          }),
        )
        .optional(),
      options: z
        .object({
          apiKey: z.string().optional(),
          baseURL: z.string().optional(),
          setCacheKey: z.boolean().optional().describe("Enable promptCacheKey for this provider (default false)"),
          timeout: z
            .union([
              z
                .number()
                .int()
                .positive()
                .describe(
                  "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
                ),
              z.literal(false).describe("Disable timeout for this provider entirely."),
            ])
            .optional()
            .describe(
              "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
            ),
        })
        .catchall(z.any())
        .optional(),
    })
    .strict()
    .meta({
      ref: "ProviderConfig",
    })
  export type Provider = z.infer<typeof Provider>

  export const Memory = z
    .object({
      required: z.boolean().optional().describe("Require memory backend availability before prompting"),
      backend: z.enum(["file", "redis", "qdrant"]).optional().describe("Memory backend"),
      storagePath: z.string().optional().describe("Storage path for file backend"),
      redisUrl: z.string().optional().describe("Redis connection URL"),
      qdrantUrl: z.string().optional().describe("Qdrant endpoint URL"),
      // qdrantApiKey removed: Qdrant is local-only, no remote support
      qdrantCollection: z.string().optional().describe("Qdrant collection for memory"),
      qdrant: z
        .object({
          url: z.string().optional().describe("Qdrant endpoint URL (must be localhost)"),
          collection: z.string().optional().describe("Qdrant collection for memory"),
        })
        .optional()
        .describe("Nested Qdrant configuration (local-only)"),
      embedding: z
        .object({
          profile: z.string().optional().describe("Embedding profile (google/gemini-embedding-001)"),
          provider: z.literal("google").optional().describe('Embedding provider ID ("google").'),
          model: z.string().optional().describe("Embedding model name (Google)"),
          dimensions: z.number().int().positive().optional().describe("Embedding vector dimensions"),
          dimension: z.number().int().positive().optional().describe("Alias for dimensions"),
          baseUrl: z.string().optional().describe("Embedding API base URL (Google)"),
        })
        .optional()
        .describe("Embedding provider configuration (Google-only; API key is read from `zee auth login google`)"),
      reranker: z
        .object({
          enabled: z.boolean().optional().describe("Enable reranking for memory search"),
          provider: z.enum(["voyage", "vllm"]).optional().describe("Reranker provider"),
          model: z.string().optional().describe("Reranker model name"),
          apiKey: z.string().optional().describe("Reranker API key"),
          baseUrl: z.string().optional().describe("Reranker API base URL"),
        })
        .optional()
        .describe("Reranker configuration for two-stage retrieval"),
      localIndex: z
        .object({
          enabled: z.boolean().optional().describe("Enable local keyword index as secondary store"),
          backend: z.enum(["sqlite-fts"]).optional().describe("Local index backend (sqlite-fts)"),
          dbDir: z.string().optional().describe("Local index database directory"),
          dbName: z.string().optional().describe("Local index database filename"),
          degradedRead: z
            .enum(["off", "keyword_only"])
            .optional()
            .describe("Allow keyword-only local reads when Qdrant is unavailable"),
        })
        .optional()
        .describe("Secondary local index configuration (Qdrant remains source of truth)"),
      defaultTtl: z.number().int().nonnegative().optional().describe("Default TTL in seconds"),
      autoSaveInterval: z.number().int().nonnegative().optional().describe("Auto-save interval in ms"),
      compression: z.boolean().optional().describe("Enable compression"),
      namespace: z.string().optional().describe("Memory namespace"),
    })
    .strict()
    .meta({
      ref: "MemoryConfig",
    })

  export const Stanley = z
    .object({
      enabled: z.boolean().optional().default(true).describe("Enable Stanley investment tools"),
      baseUrl: z.string().optional().default("http://127.0.0.1:8000").describe("Stanley API base URL"),
      apiKey: z.string().optional().describe("Stanley API key"),
      autoStart: z.boolean().optional().default(true).describe("Auto-start Stanley daemon if not running"),
      wsEnabled: z.boolean().optional().default(false).describe("Enable WebSocket for real-time data"),
      repoPath: z.string().optional().describe("Path to Stanley repository"),
    })
    .strict()
    .meta({
      ref: "StanleyConfig",
    })

  export const Zee = z
    .object({
      splitwise: z
        .object({
          enabled: z.boolean().optional().describe("Enable Splitwise tooling"),
          token: z.string().optional().describe("Splitwise OAuth token (Bearer)"),
          tokenFile: z.string().optional().describe("Path to file containing Splitwise token"),
          baseUrl: z.string().optional().describe("Splitwise API base URL override"),
          timeoutMs: z.number().int().positive().optional().describe("Splitwise API timeout in ms"),
        })
        .optional()
        .describe("Splitwise API configuration"),
      codexbar: z
        .object({
          enabled: z.boolean().optional().describe("Enable CodexBar tooling"),
          command: z
            .union([z.string(), z.array(z.string())])
            .optional()
            .describe("CodexBar CLI command override"),
          timeoutMs: z.number().int().positive().optional().describe("CodexBar CLI timeout in ms"),
        })
        .optional()
        .describe("CodexBar CLI configuration"),
    })
    .strict()
    .meta({
      ref: "ZeeConfig",
    })

  export const Messages = z
    .object({
      tts: z
        .object({
          provider: z.enum(["minimax", "openai"]).optional().describe("TTS provider to use"),
          auto: z.enum(["always", "never", "on-request"]).optional().describe("When to automatically speak responses"),
          minimax: z
            .object({
              voice: z.string().optional().describe("MiniMax voice ID"),
              model: z.string().optional().describe("MiniMax TTS model"),
            })
            .optional()
            .describe("MiniMax TTS configuration"),
          openai: z
            .object({
              voice: z.string().optional().describe("OpenAI TTS voice"),
              model: z.string().optional().describe("OpenAI TTS model"),
            })
            .optional()
            .describe("OpenAI TTS configuration"),
        })
        .optional()
        .describe("Text-to-speech configuration"),
    })
    .passthrough()
    .meta({
      ref: "MessagesConfig",
    })

  export const Info = z
    .object({
      $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
      theme: z.string().optional().describe("Theme name to use for the interface"),
      profile: z
        .enum(["assistant", "engine"])
        .optional()
        .describe("Onboarding profile preset (assistant = single-user/channel-first, engine = full flexibility)"),
      keybinds: Keybinds.optional().describe("Custom keybind configurations"),
      logLevel: Log.Level.optional().describe("Log level"),
      wideEvents: z
        .object({
          enabled: z.boolean().optional().describe("Enable wide event logging"),
          file: z.string().optional().describe("Wide event log file path"),
          sampleRate: z.number().min(0).max(1).optional().describe("Sample rate for successful events"),
          slowMs: z.number().int().nonnegative().optional().describe("Slow event threshold in ms"),
          payloads: z
            .union([z.literal("summary"), z.literal("debug"), z.literal("full")])
            .optional()
            .describe("Payload detail policy for wide events"),
        })
        .optional()
        .describe("Wide event logging configuration"),
      tui: TUI.optional().describe("TUI specific settings"),
      grammar: Grammar.optional().describe("Grammar checking configuration"),
      server: Server.optional().describe("Server configuration for zee serve and web commands"),
      daemon: Daemon.optional().describe("Daemon mode configuration for headless operation"),
      flux: Flux.optional().describe("Token and API ingress-egress observability configuration"),
      heartbeat: z
        .object({
          enabled: z.boolean().optional().default(true).describe("Enable heartbeat check-ins"),
          every: z.string().optional().default("30m").describe("Heartbeat interval (e.g. 30m, 1h, 2h)"),
          path: z
            .string()
            .optional()
            .describe(
              "Path to heartbeat instruction file (defaults to ~/.local/state/zee/workspace/HEARTBEAT.md with legacy fallback to <daemon directory>/HEARTBEAT.md)",
            ),
          prompt: z.string().optional().describe("Custom heartbeat prompt override"),
          model: z.string().optional().describe("Model to use for heartbeat runs"),
          activeHours: z
            .object({
              start: z.string().optional().default("08:00").describe("Active hours start (HH:MM)"),
              end: z.string().optional().default("22:00").describe("Active hours end (HH:MM)"),
              timezone: z.string().optional().describe("Timezone for active hours"),
            })
            .optional()
            .describe("Restrict heartbeat to active hours"),
        })
        .optional()
        .describe("Heartbeat configuration for proactive check-ins"),
      cron: z
        .object({
          enabled: z.boolean().optional().default(true).describe("Enable cron job scheduler"),
          storeDir: z.string().optional().describe("Directory for cron job store (default: ~/.config/zee/cron)"),
          toolInvokeAllowlist: z
            .array(z.string())
            .optional()
            .describe(
              'Allowlist of tool IDs permitted for cron jobs with payload.kind="toolInvoke". Defaults to a small built-in safe list.',
            ),
        })
        .optional()
        .describe("Cron job scheduler configuration"),
      command: z.record(z.string(), Command).optional().describe("Command configuration"),
      skills: Skills.optional().describe("Additional skill folder paths"),
      watcher: z
        .object({
          ignore: z.array(z.string()).optional(),
        })
        .optional(),
      plugin: z.string().array().optional(),
      snapshot: z.boolean().optional(),
      share: z
        .enum(["manual", "auto", "disabled"])
        .optional()
        .describe(
          "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
        ),
      autoupdate: z
        .union([z.boolean(), z.literal("notify")])
        .optional()
        .describe(
          "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
        ),
      disabled_providers: z.array(z.string()).optional().describe("Disable providers that are loaded automatically"),
      model: z.string().describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
      models: z
        .object({
          url: z.string().optional().describe("Base URL for model catalog discovery (defaults to https://models.dev)"),
          path: z.string().optional().describe("Local path to a models catalog JSON file"),
        })
        .optional()
        .describe("Model catalog source settings"),
      small_model: z
        .string()
        .describe("Small model to use for tasks like title generation in the format of provider/model")
        .optional(),
      default_agent: z
        .string()
        .optional()
        .describe(
          "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
        ),
      username: z
        .string()
        .optional()
        .describe("Custom username to display in conversations instead of system username"),
      mode: z
        .object({
          build: Agent.optional(),
          plan: Agent.optional(),
        })
        .catchall(Agent)
        .optional()
        .describe("@deprecated Use `agent` field instead."),
      agent: z
        .object({
          // primary
          plan: Agent.optional(),
          build: Agent.optional(),
          // subagent
          general: Agent.optional(),
          explore: Agent.optional(),
          // specialized
          title: Agent.optional(),
          summary: Agent.optional(),
          compaction: Agent.optional(),
        })
        .catchall(Agent)
        .optional()
        .describe("Agent configuration"),
      provider: z
        .record(z.string(), Provider)
        .optional()
        .describe("Custom provider configurations and model overrides"),
      mcp: z
        .record(
          z.string(),
          z.union([
            Mcp,
            z
              .object({
                enabled: z.boolean(),
              })
              .strict(),
          ]),
        )
        .optional()
        .describe("MCP (Model Context Protocol) server configurations"),
      memory: Memory.optional().describe("Memory and storage configuration"),
      stanley: Stanley.optional().describe("Stanley investment platform configuration"),
      zee: Zee.optional().describe("Zee integration configuration"),
      messages: Messages.optional().describe("Messaging and TTS configuration"),
      formatter: z
        .union([
          z.literal(false),
          z.record(
            z.string(),
            z.object({
              disabled: z.boolean().optional(),
              command: z.array(z.string()).optional(),
              environment: z.record(z.string(), z.string()).optional(),
              extensions: z.array(z.string()).optional(),
            }),
          ),
        ])
        .optional(),
      lsp: z
        .union([
          z.literal(false),
          z.record(
            z.string(),
            z.union([
              z.object({
                disabled: z.literal(true),
              }),
              z.object({
                command: z.array(z.string()),
                extensions: z.array(z.string()).optional(),
                disabled: z.boolean().optional(),
                env: z.record(z.string(), z.string()).optional(),
                initialization: z.record(z.string(), z.any()).optional(),
              }),
            ]),
          ),
        ])
        .optional()
        .refine(
          (data) => {
            if (!data) return true
            if (typeof data === "boolean") return true
            const serverIds = new Set(Object.values(LSPServer).map((s) => s.id))

            return Object.entries(data).every(([id, config]) => {
              if (config.disabled) return true
              if (serverIds.has(id)) return true
              return Boolean(config.extensions)
            })
          },
          {
            error: "For custom LSP servers, 'extensions' array is required.",
          },
        ),
      instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
      layout: Layout.optional().describe("@deprecated Always uses stretch layout."),
      permission: Permission.optional(),
      tools: z.record(z.string(), z.boolean()).optional(),
      enterprise: z
        .object({
          url: z.string().optional().describe("Enterprise URL"),
        })
        .optional(),
      compaction: z
        .object({
          auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
          prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
          reserved: z.number().optional().describe("Number of tokens to reserve from the context window"),
        })
        .optional(),
      experimental: z
        .object({
          hook: z
            .object({
              file_edited: z
                .record(
                  z.string(),
                  z
                    .object({
                      command: z.string().array(),
                      environment: z.record(z.string(), z.string()).optional(),
                    })
                    .array(),
                )
                .optional(),
              session_completed: z
                .object({
                  command: z.string().array(),
                  environment: z.record(z.string(), z.string()).optional(),
                })
                .array()
                .optional(),
            })
            .optional(),
          chatMaxRetries: z.number().optional().describe("Number of retries for chat completions on failure"),
          disable_paste_summary: z.boolean().optional(),
          batch_tool: z.boolean().optional().describe("Enable the batch tool"),
          primary_tools: z
            .array(z.string())
            .optional()
            .describe("Tools that should only be available to primary agents."),
          continue_loop_on_deny: z.boolean().optional().describe("Continue the agent loop when a tool call is denied"),
          mcp_timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Timeout in milliseconds for model context protocol (MCP) requests"),
          surfaces: z
            .object({
              cli: z
                .object({
                  enabled: z.boolean().optional(),
                })
                .optional(),
              whatsapp: z
                .object({
                  enabled: z.boolean().optional(),
                  sessionName: z.string().optional(),
                  allowedNumbers: z.string().array().optional(),
                  allowedGroups: z.string().array().optional(),
                  requireMention: z.boolean().optional(),
                  operators: z.string().array().optional(),
                  releasePin: z.string().optional(),
                  releaseTimeoutMs: z.number().default(900_000),
                })
                .optional(),
              telegram: z
                .object({
                  enabled: z.boolean().optional(),
                  token: z.string().optional().describe("Telegram bot token (fallbacks to TELEGRAM_BOT_TOKEN env)"),
                  apiBaseUrl: z.string().optional().describe("Telegram Bot API base URL override"),
                  pollTimeoutSec: z.number().int().positive().optional(),
                  allowedChatIds: z.array(z.union([z.string(), z.number()])).optional(),
                  allowedSenders: z.string().array().optional(),
                  allowedGroups: z.string().array().optional(),
                  requireMention: z.boolean().optional(),
                  operators: z.string().array().optional(),
                  mediaMaxMb: z.number().positive().optional(),
                  streamEditIntervalMs: z.number().int().positive().optional(),
                  releasePin: z.string().optional(),
                  releaseTimeoutMs: z.number().default(900_000),
                })
                .optional(),
              analytics: z
                .object({
                  enabled: z.boolean().optional(),
                })
                .optional(),
              hotReload: z
                .object({
                  enabled: z.boolean().optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .optional(),
      fallback: z
        .object({
          enabled: z
            .boolean()
            .default(true)
            .describe("Enable automatic fallback to alternative providers/models on failure"),
          maxAttempts: z
            .number()
            .int()
            .positive()
            .default(3)
            .describe("Maximum total attempts including the original request"),
          circuitBreaker: z
            .object({
              failureThreshold: z
                .number()
                .int()
                .positive()
                .default(3)
                .describe("Number of consecutive failures before opening the circuit"),
              successThreshold: z
                .number()
                .int()
                .positive()
                .default(2)
                .describe("Number of consecutive successes in half_open to close the circuit"),
              timeout: z
                .number()
                .int()
                .positive()
                .default(60000)
                .describe("Time in ms before transitioning from open to half_open"),
            })
            .optional()
            .describe("Circuit breaker configuration for provider health management"),
          rules: z
            .array(
              z.object({
                condition: z
                  .enum(["rate_limit", "unavailable", "timeout", "error", "circuit_open", "any"])
                  .describe("Error condition that triggers this rule"),
                fallbacks: z
                  .array(z.string())
                  .describe("Fallback options - 'providerID/modelID' or just 'providerID' for equivalent tier"),
              }),
            )
            .optional()
            .describe("Fallback rules in priority order"),
          tiers: z
            .object({
              flagship: z.array(z.string()).optional().describe("Flagship-tier model mappings for equivalence fallback"),
              standard: z.array(z.string()).optional().describe("Standard-tier model mappings for equivalence fallback"),
              fast: z.array(z.string()).optional().describe("Fast-tier model mappings for equivalence fallback"),
            })
            .optional()
            .describe("Custom model-equivalence tiers used by fallback provider selection"),
          costAware: z.boolean().default(false).describe("Skip fallbacks that cost more than the original model"),
          notifyOnFallback: z.boolean().default(true).describe("Emit event/notification when fallback is used"),
        })
        .optional()
        .describe("Provider/model fallback configuration for automatic failover"),
      gateway: z
        .union([Gateway, z.unknown()])
        .optional()
        .describe("Gateway configuration including controlUi auth guardrails"),
      channels: z.unknown().optional(),
      bridge: z.unknown().optional(),
      commands: z.unknown().optional(),
      agents: z.unknown().optional(),
      plugins: z.unknown().optional(),
      meta: z.unknown().optional(),
    })
    .strict()
    .meta({
      ref: "Config",
    })

  export type Info = z.output<typeof Info>

  export const global = lazy(async () => {
    let result: Info = pipe({}, mergeDeep(await loadFile(path.join(Global.Path.config, "zee.jsonc"))))

    return result
  })

  async function loadFile(filepath: string): Promise<Info> {
    const safePath = Filesystem.sanitizePath(filepath)
    log.info("loading", { path: safePath })
    let text = await Bun.file(safePath)
      .text()
      .catch((err) => {
        if (err.code === "ENOENT") return
        throw new JsonError({ path: safePath }, { cause: err })
      })
    if (!text) return {}
    return load(text, safePath)
  }

  async function load(text: string, configFilepath: string) {
    const original = text
    text = text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || ""
    })

    const fileMatches = text.match(/\{file:[^}]+\}/g)
    if (fileMatches) {
      const configDir = path.dirname(configFilepath)
      const lines = text.split("\n")

      for (const match of fileMatches) {
        const lineIndex = lines.findIndex((line) => line.includes(match))
        if (lineIndex !== -1 && lines[lineIndex].trim().startsWith("//")) {
          continue // Skip if line is commented
        }
        let filePath = match.replace(/^\{file:/, "").replace(/\}$/, "")
        if (filePath.startsWith("~/")) {
          filePath = path.join(os.homedir(), filePath.slice(2))
        }
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
        const fileContent = (
          await Bun.file(resolvedPath)
            .text()
            .catch((error) => {
              const errMsg = `bad file reference: "${match}"`
              if (error.code === "ENOENT") {
                throw new InvalidError(
                  {
                    path: configFilepath,
                    message: errMsg + ` ${resolvedPath} does not exist`,
                  },
                  { cause: error },
                )
              }
              throw new InvalidError({ path: configFilepath, message: errMsg }, { cause: error })
            })
        ).trim()
        // escape newlines/quotes, strip outer quotes
        text = text.replace(match, JSON.stringify(fileContent).slice(1, -1))
      }
    }

    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const lines = text.split("\n")
      const errorDetails = errors
        .map((e) => {
          const beforeOffset = text.substring(0, e.offset).split("\n")
          const line = beforeOffset.length
          const column = beforeOffset[beforeOffset.length - 1].length + 1
          const problemLine = lines[line - 1]

          const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
          if (!problemLine) return error

          return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
        })
        .join("\n")

      throw new JsonError({
        path: configFilepath,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    let parsed = Info.safeParse(data)

    if (parsed.success) {
      if (!parsed.data.$schema) {
        parsed.data.$schema = "zee"
        // Write the $schema to the original text to preserve variables like {env:VAR}
        const updated = original.replace(/^\s*\{/, '{\n  "$schema": "zee",')
        await Bun.write(configFilepath, updated).catch((err) => {
          log.debug("failed to write config schema", { error: String(err), path: configFilepath })
        })
      }
      const data = parsed.data
      if (data.plugin) {
        for (let i = 0; i < data.plugin.length; i++) {
          const plugin = data.plugin[i]
          try {
            data.plugin[i] = import.meta.resolve!(plugin, configFilepath)
          } catch (err) {
            log.warn("failed to resolve plugin path", { plugin, error: err })
          }
        }
      }
      return data
    }

    throw new InvalidError({
      path: configFilepath,
      issues: parsed.error.issues,
    })
  }
  export const JsonError = NamedError.create(
    "ConfigJsonError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
    }),
  )

  export const ConfigDirectoryTypoError = NamedError.create(
    "ConfigDirectoryTypoError",
    z.object({
      path: z.string(),
      dir: z.string(),
      suggestion: z.string(),
    }),
  )

  export const InvalidError = NamedError.create(
    "ConfigInvalidError",
    z.object({
      path: z.string(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
      message: z.string().optional(),
    }),
  )

  export async function get() {
    return state().then((x) => x.config)
  }

  export async function update(config: Info) {
    const filepath = path.join(Instance.directory, "zee.jsonc")
    const existing = await loadFile(filepath)
    const merged = mergeDeep(existing, config)

    // Validate merged config before writing to prevent invalid state
    const validated = Info.safeParse(merged)
    if (!validated.success) {
      throw new Error(`Invalid configuration: ${validated.error.message}`)
    }

    await Bun.write(filepath, JSON.stringify(merged, null, 2))
    await Instance.dispose()
  }

  /**
   * Reload managed settings by invalidating the current instance config cache.
   * This is useful when enterprise-managed settings change at runtime.
   */
  export async function reloadManaged() {
    global.reset()
    await Instance.dispose()
    return get()
  }

  export async function directories() {
    return state().then((x) => x.directories)
  }

  export function redact(config: Info): Info {
    const copy = structuredClone(config)
    // Redact provider api keys
    if (copy.provider) {
      for (const provider of Object.values(copy.provider)) {
        if (provider?.options?.apiKey) {
          provider.options.apiKey = "********"
        }
      }
    }
    // Redact memory secrets
    if (copy.memory) {
      if (copy.memory.redisUrl) copy.memory.redisUrl = "********"
      // Legacy: redact deprecated memory.embedding.apiKey if it exists on unvalidated inputs.
      const embedding = (copy.memory as unknown as { embedding?: Record<string, unknown> }).embedding
      if (embedding && typeof embedding.apiKey === "string" && embedding.apiKey.length > 0) {
        embedding.apiKey = "********"
      }
      if (copy.memory.reranker?.apiKey) copy.memory.reranker.apiKey = "********"
    }
    // Redact zee secrets
    if (copy.zee?.splitwise?.token) copy.zee.splitwise.token = "********"

    // Legacy: redact grammar.apiKey if present on unvalidated inputs.
    const grammar = copy.grammar as unknown as { apiKey?: unknown } | undefined
    if (typeof grammar?.apiKey === "string" && grammar.apiKey.length > 0) {
      grammar.apiKey = "********"
    }

    // Redact MCP secrets
    if (copy.mcp) {
      for (const mcp of Object.values(copy.mcp)) {
        if (
          typeof mcp === "object" &&
          "type" in mcp &&
          mcp.type === "remote" &&
          "oauth" in mcp &&
          mcp.oauth &&
          typeof mcp.oauth === "object" &&
          "clientSecret" in mcp.oauth &&
          mcp.oauth.clientSecret
        ) {
          ;(mcp.oauth as { clientSecret?: string }).clientSecret = "********"
        }
      }
    }

    return copy
  }

  export function clean(config: Info): Info {
    const copy = structuredClone(config)
    const traverse = (obj: any) => {
      if (!obj || typeof obj !== "object") return
      for (const key in obj) {
        if (obj[key] === "********") {
          delete obj[key]
        } else {
          traverse(obj[key])
        }
      }
    }
    traverse(copy)
    return copy
  }
}
