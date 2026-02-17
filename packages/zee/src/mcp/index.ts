import { dynamicTool, type Tool, jsonSchema, type JSONSchema7 } from "ai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import path from "node:path"
import { existsSync } from "node:fs"
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { NamedError } from "@zee/util/error"
import z from "zod/v4"
import { Instance } from "../project/instance"
import { Installation } from "../installation"
import { withTimeout } from "@/util/timeout"
import { McpOAuthProvider } from "./oauth-provider"
import { McpOAuthCallback } from "./oauth-callback"
import { McpAuth } from "./auth"
import { Auth } from "../auth"
import { Identifier } from "../id/id"
import { BusEvent } from "../bus/bus-event"
import { Bus } from "@/bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { getZeeRoot } from "../paths"
import { Global } from "@/global"
import { getAllPersonaMcpServers } from "../../../../src/mcp/servers"
import open from "open"
import { normalizeHttpUrl } from "@/util/net"

export namespace MCP {
  const log = Log.create({ service: "mcp" })
  const DEFAULT_TIMEOUT = 30_000
  const LOCAL_STDERR_TAIL_MAX_BYTES = 2_048
  const HEALTH_MONITOR_INTERVAL_MS = 15_000
  const LOCAL_NODE_FALLBACK_SERVERS = new Set(["portfolio", "consciousness"])

  // Per-server mutex to prevent concurrent state mutations for the same server
  const serverMutexes = new Map<string, Promise<void>>()
  // Global gate for local MCP startup to avoid burst spawning multiple local runtimes at once.
  let localStartupGate: Promise<void> = Promise.resolve()

  // Per-server tool cache -- invalidated on tools/list_changed, reconnect, disconnect, add
  type ToolCacheEntry = { tools: MCPToolDef[]; cachedAt: number }
  const toolCache = new Map<string, ToolCacheEntry>()
  const BUILTIN_LOCAL_MCP_SERVERS = new Set(["calendar", "consciousness", "memory", "portfolio"])

  type LocalFailureClass =
    | "connection_closed"
    | "spawn_failed"
    | "runtime_crash"
    | "timeout"
    | "protocol_error"
    | "crash_loop"
    | "unknown"

  type LocalServerHealth = {
    consecutiveFailures: number
    firstFailureAt?: number
    lastFailureAt?: number
    lastHealthyAt?: number
    lastFailureClass?: LocalFailureClass
    lastError?: string
    cooldownUntil?: number
  }

  type LocalMcpResilienceConfig = {
    startupMaxAttempts: number
    startupBackoffMs: number[]
    crashLoopThreshold: number
    crashLoopWindowMs: number
    crashLoopCooldownMs: number
  }

  const defaultLocalMcpResilienceConfig: LocalMcpResilienceConfig = {
    startupMaxAttempts: 4,
    startupBackoffMs: [250, 1_000, 3_000],
    crashLoopThreshold: 5,
    crashLoopWindowMs: 120_000,
    crashLoopCooldownMs: 60_000,
  }

  let localMcpResilienceConfig: LocalMcpResilienceConfig = {
    ...defaultLocalMcpResilienceConfig,
    startupBackoffMs: [...defaultLocalMcpResilienceConfig.startupBackoffMs],
  }

  const localServerHealth = new Map<string, LocalServerHealth>()

  async function withServerMutex<T>(serverName: string, fn: () => T | Promise<T>): Promise<T> {
    const currentMutex = serverMutexes.get(serverName) ?? Promise.resolve()
    let release: () => void
    const newMutex = new Promise<void>((resolve) => {
      release = resolve
    })
    serverMutexes.set(serverName, newMutex)
    await currentMutex
    try {
      return await fn()
    } finally {
      release!()
      // Clean up mutex if this is the last one
      if (serverMutexes.get(serverName) === newMutex) {
        serverMutexes.delete(serverName)
      }
    }
  }

  async function withLocalStartupGate<T>(fn: () => T | Promise<T>): Promise<T> {
    const pending = localStartupGate
    let release: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    localStartupGate = pending.then(
      () => next,
      () => next,
    )
    await pending
    try {
      return await fn()
    } finally {
      release!()
    }
  }

  function normalizeBuiltinLocalServerName(serverName: string): string {
    return serverName.replace(/^personas-/, "")
  }

  function isBuiltinLocalServer(serverName: string): boolean {
    return BUILTIN_LOCAL_MCP_SERVERS.has(normalizeBuiltinLocalServerName(serverName))
  }

  function getOrCreateLocalServerHealth(serverName: string): LocalServerHealth {
    const existing = localServerHealth.get(serverName)
    if (existing) return existing
    const created: LocalServerHealth = {
      consecutiveFailures: 0,
    }
    localServerHealth.set(serverName, created)
    return created
  }

  function clearExpiredLocalCooldown(serverName: string, now = Date.now()): LocalServerHealth | undefined {
    const health = localServerHealth.get(serverName)
    if (!health?.cooldownUntil) return health
    if (health.cooldownUntil > now) return health

    health.cooldownUntil = undefined
    health.consecutiveFailures = 0
    health.firstFailureAt = undefined
    health.lastFailureAt = undefined
    return health
  }

  function getActiveLocalCooldown(serverName: string, now = Date.now()): LocalServerHealth | undefined {
    const health = clearExpiredLocalCooldown(serverName, now)
    if (!health?.cooldownUntil) return undefined
    if (health.cooldownUntil <= now) return undefined
    return health
  }

  function describeCrashLoop(serverName: string, health: LocalServerHealth, now = Date.now()): string {
    const until = health.cooldownUntil ?? now
    const remainingSeconds = Math.max(0, Math.ceil((until - now) / 1000))
    const retryAt = new Date(until).toISOString()
    const windowSeconds = Math.round(localMcpResilienceConfig.crashLoopWindowMs / 1000)
    const failureCount = Math.max(health.consecutiveFailures, localMcpResilienceConfig.crashLoopThreshold)
    const lastClass = health.lastFailureClass ?? "unknown"
    const lastError = health.lastError ?? "Unknown local MCP failure"
    return [
      `Local MCP crash loop [crash_loop]: ${failureCount} failures within ${windowSeconds}s.`,
      `Cooling down for ${remainingSeconds}s until ${retryAt}.`,
      `Last failure [${lastClass}]: ${lastError}`,
      `Server: ${serverName}`,
    ].join(" ")
  }

  function buildLocalFailureStatus(
    serverName: string,
    failureClass: LocalFailureClass,
    message: string,
    options: {
      attempt?: number
      totalAttempts?: number
      cooldownActive?: boolean
      now?: number
    } = {},
  ): Status {
    if (failureClass === "crash_loop" || options.cooldownActive) {
      const health = getOrCreateLocalServerHealth(serverName)
      return {
        status: "failed",
        error: describeCrashLoop(serverName, health, options.now),
      }
    }

    const attemptPrefix =
      options.attempt && options.totalAttempts
        ? `attempt ${options.attempt}/${options.totalAttempts}`
        : options.attempt
          ? `attempt ${options.attempt}`
          : undefined
    const detail = attemptPrefix ? ` (${attemptPrefix})` : ""
    return {
      status: "failed",
      error: `Local MCP startup failed [${failureClass}]${detail}: ${message}`,
    }
  }

  function isCrashLoopStatusMessage(message: string): boolean {
    return message.includes("Local MCP crash loop [crash_loop]:")
  }

  function isBunRuntimeCrashMessage(message: string): boolean {
    const lowered = message.toLowerCase()
    return (
      lowered.includes("oh no: bun has crashed") ||
      lowered.includes("panic(main thread):") ||
      lowered.includes("illegal instruction") ||
      lowered.includes("bun.report/")
    )
  }

  function normalizeLocalFailureStatusForRead(serverName: string, current: Status, now = Date.now()): Status {
    if (current.status !== "failed") return current

    const activeCooldown = getActiveLocalCooldown(serverName, now)
    if (activeCooldown) {
      return buildLocalFailureStatus(serverName, "crash_loop", current.error, {
        cooldownActive: true,
        now,
      })
    }

    if (!isCrashLoopStatusMessage(current.error)) return current

    const health = localServerHealth.get(serverName)
    if (!health?.lastError) return current

    return buildLocalFailureStatus(serverName, health.lastFailureClass ?? "unknown", health.lastError)
  }

  function classifyLocalFailure(error: unknown): { className: LocalFailureClass; message: string } {
    const message = error instanceof Error ? error.message : String(error)
    const lowered = message.toLowerCase()

    if (lowered.includes("[zee-mcp:") && lowered.includes("parent process") && lowered.includes("exiting")) {
      return { className: "runtime_crash", message }
    }

    if (isBunRuntimeCrashMessage(message)) {
      return { className: "runtime_crash", message }
    }

    if (
      lowered.includes("connection closed") ||
      lowered.includes("eof") ||
      lowered.includes("closed before response") ||
      lowered.includes("socket hang up")
    ) {
      return { className: "connection_closed", message }
    }
    if (
      lowered.includes("spawn") ||
      lowered.includes("eagain") ||
      lowered.includes("emfile") ||
      lowered.includes("enfile") ||
      lowered.includes("enoent") ||
      lowered.includes("eacces") ||
      lowered.includes("not found") ||
      lowered.includes("executable")
    ) {
      return { className: "spawn_failed", message }
    }
    if (lowered.includes("timeout")) {
      return { className: "timeout", message }
    }
    if (lowered.includes("jsonrpc") || lowered.includes("protocol") || lowered.includes("parse")) {
      return { className: "protocol_error", message }
    }

    return { className: "unknown", message }
  }

  function isRetryableLocalFailure(failureClass: LocalFailureClass, message: string): boolean {
    if (failureClass === "spawn_failed") {
      const lowered = message.toLowerCase()
      return (
        lowered.includes("eagain") ||
        lowered.includes("emfile") ||
        lowered.includes("enfile") ||
        lowered.includes("temporarily unavailable")
      )
    }

    return (
      failureClass === "runtime_crash" ||
      failureClass === "connection_closed" ||
      failureClass === "timeout" ||
      failureClass === "protocol_error"
    )
  }

  function deterministicJitter(serverName: string, attempt: number, maxJitterMs: number): number {
    if (maxJitterMs <= 0) return 0
    let hash = 17
    const key = `${serverName}:${attempt}`
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0
    }
    const range = maxJitterMs * 2 + 1
    return (hash % range) - maxJitterMs
  }

  function getLocalRetryDelayMs(serverName: string, attempt: number): number {
    const configured = localMcpResilienceConfig.startupBackoffMs[Math.max(0, attempt - 1)] ?? 0
    if (configured <= 0) return 0
    const jitterLimit = Math.max(1, Math.floor(configured * 0.15))
    const jitter = deterministicJitter(serverName, attempt, jitterLimit)
    return Math.max(0, configured + jitter)
  }

  async function sleepMs(ms: number): Promise<void> {
    if (ms <= 0) return
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  function markLocalServerHealthy(serverName: string, now = Date.now()): void {
    const health = getOrCreateLocalServerHealth(serverName)
    health.consecutiveFailures = 0
    health.firstFailureAt = undefined
    health.lastFailureAt = undefined
    health.lastFailureClass = undefined
    health.lastError = undefined
    health.cooldownUntil = undefined
    health.lastHealthyAt = now
  }

  function registerLocalServerFailure(
    serverName: string,
    failureClass: LocalFailureClass,
    message: string,
    now = Date.now(),
  ): LocalServerHealth {
    const health = getOrCreateLocalServerHealth(serverName)
    const windowMs = Math.max(1, localMcpResilienceConfig.crashLoopWindowMs)
    const windowExpired =
      !health.firstFailureAt ||
      now - health.firstFailureAt > windowMs ||
      (health.cooldownUntil !== undefined && health.cooldownUntil <= now)

    if (windowExpired) {
      health.consecutiveFailures = 1
      health.firstFailureAt = now
    } else {
      health.consecutiveFailures += 1
    }

    health.lastFailureAt = now
    health.lastFailureClass = failureClass
    health.lastError = message

    if (health.consecutiveFailures >= localMcpResilienceConfig.crashLoopThreshold) {
      health.cooldownUntil = now + localMcpResilienceConfig.crashLoopCooldownMs
    } else {
      health.cooldownUntil = undefined
    }

    return health
  }

  const AUTH_PLACEHOLDER = /\{auth:([^}]+)\}/g
  const AUTH_ENV_KEYS: Record<string, string[]> = {
    kernel: ["KERNEL_API_KEY", "KERNEL_MCP_API_KEY"],
  }

  function resolveAuthFromEnv(id: string): { value?: string; keys?: string[] } {
    const keys = AUTH_ENV_KEYS[id]
    if (!keys || keys.length === 0) return {}
    for (const key of keys) {
      const value = process.env[key]
      if (value && value.trim()) {
        return { value: value.trim(), keys }
      }
    }
    return { keys }
  }

  async function resolveAuthPlaceholder(value: string): Promise<string> {
    const matches = Array.from(value.matchAll(AUTH_PLACEHOLDER))
    if (matches.length === 0) return value

    const ids = Array.from(new Set(matches.map((match) => match[1]?.trim()).filter(Boolean)))
    const authEntries = new Map<string, Auth.Info | undefined>()

    for (const id of ids) {
      authEntries.set(id, await Auth.get(id))
    }

    let resolved = value
    for (const id of ids) {
      const auth = authEntries.get(id)
      if (!auth) {
        const env = resolveAuthFromEnv(id)
        if (env.value) {
          resolved = resolved.replaceAll(`{auth:${id}}`, env.value)
          continue
        }
        const hint = env.keys?.length
          ? `Set ${env.keys.join(" or ")} or run: zee auth login ${id}`
          : `Run: zee auth login ${id}`
        throw new Error(`Missing auth for "${id}". ${hint}`)
      }
      if (auth.type === "api") {
        resolved = resolved.replaceAll(`{auth:${id}}`, auth.key)
        continue
      }
      if (auth.type === "oauth") {
        resolved = resolved.replaceAll(`{auth:${id}}`, auth.access)
        continue
      }
      if (auth.type === "wellknown") {
        resolved = resolved.replaceAll(`{auth:${id}}`, auth.token)
        continue
      }
      throw new Error(`Unsupported auth type for "${id}". Run: zee auth login ${id}`)
    }

    return resolved
  }

  async function resolveMcpHeaders(headers?: Record<string, string>): Promise<Record<string, string> | undefined> {
    if (!headers) return undefined
    const resolved: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
      resolved[key] = await resolveAuthPlaceholder(value)
    }
    return resolved
  }

  export const Resource = z
    .object({
      name: z.string(),
      uri: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
      client: z.string(),
    })
    .meta({ ref: "McpResource" })
  export type Resource = z.infer<typeof Resource>

  export const ToolsChanged = BusEvent.define(
    "mcp.tools.changed",
    z.object({
      server: z.string(),
    }),
  )

  export const BrowserOpenFailed = BusEvent.define(
    "mcp.browser.open.failed",
    z.object({
      mcpName: z.string(),
      url: z.string(),
    }),
  )

  export const Failed = NamedError.create(
    "MCPFailed",
    z.object({
      name: z.string(),
    }),
  )

  type MCPClient = Client

  export const Status = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({
          ref: "MCPStatusConnected",
        }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({
          ref: "MCPStatusDisabled",
        }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusFailed",
        }),
      z
        .object({
          status: z.literal("needs_auth"),
        })
        .meta({
          ref: "MCPStatusNeedsAuth",
        }),
      z
        .object({
          status: z.literal("needs_client_registration"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusNeedsClientRegistration",
        }),
    ])
    .meta({
      ref: "MCPStatus",
    })
  export type Status = z.infer<typeof Status>

  // Register notification handlers for MCP client
  function registerNotificationHandlers(client: MCPClient, serverName: string) {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      log.info("tools list changed notification received", { server: serverName })
      toolCache.delete(serverName)
      Bus.publish(ToolsChanged, { server: serverName })
    })
  }

  type McpCallResult = Awaited<ReturnType<MCPClient["callTool"]>>
  type McpJobStatus = "queued" | "running" | "completed" | "failed"
  type McpJob = {
    id: string
    serverName: string
    toolName: string
    args: Record<string, unknown>
    status: McpJobStatus
    createdAt: number
    startedAt?: number
    completedAt?: number
    result?: McpCallResult
    error?: string
  }

  const JOB_RETENTION_MS = 6 * 60 * 60 * 1000
  const jobStore = new Map<string, McpJob>()
  const ASYNC_DEFAULT_SERVERS = new Set(["kernel"])

  function isAsyncServer(serverName: string, entry?: Config.Mcp): boolean {
    if (entry && "async" in entry && typeof (entry as { async?: boolean }).async === "boolean") {
      return Boolean((entry as { async?: boolean }).async)
    }
    return ASYNC_DEFAULT_SERVERS.has(serverName)
  }

  function pruneJobs(now = Date.now()) {
    for (const [id, job] of jobStore.entries()) {
      if (job.status === "queued" || job.status === "running") continue
      if (!job.completedAt) continue
      if (now - job.completedAt > JOB_RETENTION_MS) {
        jobStore.delete(id)
      }
    }
  }

  async function runJob(job: McpJob) {
    job.status = "running"
    job.startedAt = Date.now()
    try {
      job.result = await callTool(job.serverName, job.toolName, job.args)
      job.status = "completed"
    } catch (error) {
      job.status = "failed"
      job.error = error instanceof Error ? error.message : String(error)
    } finally {
      job.completedAt = Date.now()
    }
  }

  function createJob(serverName: string, toolName: string, args: Record<string, unknown>): McpJob {
    pruneJobs()
    const job: McpJob = {
      id: Identifier.ascending("job"),
      serverName,
      toolName,
      args,
      status: "queued",
      createdAt: Date.now(),
    }
    jobStore.set(job.id, job)
    void runJob(job)
    return job
  }

  function getJob(jobId: string): McpJob | undefined {
    pruneJobs()
    return jobStore.get(jobId)
  }

  function createJobPollTool(serverName: string, toolId: string): Tool {
    const schema: JSONSchema7 = {
      type: "object",
      properties: {
        job_id: { type: "string" },
        consume: { type: "boolean" },
      },
      required: ["job_id"],
      additionalProperties: false,
    }

    return dynamicTool({
      description: `Check the status of async ${serverName} jobs. Returns the final result when completed.`,
      inputSchema: jsonSchema(schema),
      execute: async (args: unknown) => {
        const { job_id, consume } = (args ?? {}) as { job_id?: string; consume?: boolean }
        if (!job_id) {
          return {
            content: [{ type: "text", text: "Missing job_id." }],
            isError: true,
          }
        }

        const job = getJob(job_id)
        if (!job) {
          return {
            content: [{ type: "text", text: `Job not found: ${job_id}` }],
            isError: true,
          }
        }
        if (job.serverName !== serverName) {
          const otherToolId = `${job.serverName.replace(/[^a-zA-Z0-9_-]/g, "_")}_job_poll`
          return {
            content: [
              {
                type: "text",
                text: `Job ${job_id} belongs to ${job.serverName}. Use ${otherToolId}.`,
              },
            ],
            isError: true,
          }
        }

        if (job.status === "completed") {
          const result = job.result ?? {
            content: [{ type: "text", text: "Job completed with no output." }],
          }
          if (consume !== false) {
            jobStore.delete(job_id)
          }
          return result
        }

        if (job.status === "failed") {
          const message = job.error ?? "Job failed."
          if (consume !== false) {
            jobStore.delete(job_id)
          }
          return {
            content: [{ type: "text", text: message }],
            isError: true,
          }
        }

        const statusLine = job.status === "running" ? `Job ${job_id} is running.` : `Job ${job_id} is queued.`
        return {
          content: [{ type: "text", text: `${statusLine} Try again with ${toolId}.` }],
        }
      },
    })
  }

  // Convert MCP tool definition to AI SDK Tool type
  // Uses serverName (not client reference) so execute() does late-bound client lookup
  // via callTool(), which handles reconnection. This fixes stale client references.
  function convertMcpTool(
    mcpTool: MCPToolDef,
    serverName: string,
    options: { asyncEnabled: boolean; pollToolId: string },
  ): Tool {
    const inputSchema = mcpTool.inputSchema

    // Spread first, then override type to ensure it's always "object"
    const schema: JSONSchema7 = {
      ...(inputSchema as JSONSchema7),
      type: "object",
      properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
      additionalProperties: false,
    }

    if (options.asyncEnabled) {
      const description = [
        mcpTool.description ?? "",
        `This tool runs asynchronously and returns a job id. Use ${options.pollToolId} to fetch status/result.`,
      ]
        .filter(Boolean)
        .join("\n\n")

      return dynamicTool({
        description,
        inputSchema: jsonSchema(schema),
        execute: async (args: unknown) => {
          const job = createJob(serverName, mcpTool.name, (args ?? {}) as Record<string, unknown>)
          const text = [
            `Queued async job ${job.id} for ${serverName}/${mcpTool.name}.`,
            `Use ${options.pollToolId} with { job_id: "${job.id}" } to fetch status/result.`,
          ].join(" ")
          return {
            content: [{ type: "text", text }],
          }
        },
      })
    }

    return dynamicTool({
      description: mcpTool.description ?? "",
      inputSchema: jsonSchema(schema),
      execute: async (args: unknown) => {
        // Late-bound: callTool() looks up the current client + handles reconnect
        return callTool(serverName, mcpTool.name, (args ?? {}) as Record<string, unknown>)
      },
    })
  }

  // Store transports for OAuth servers to allow finishing auth
  type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport
  const pendingOAuthTransports = new Map<string, TransportWithAuth>()

  // Prompt cache types
  type PromptInfo = Awaited<ReturnType<MCPClient["listPrompts"]>>["prompts"][number]

  type ResourceInfo = Awaited<ReturnType<MCPClient["listResources"]>>["resources"][number]
  type McpConfigMap = NonNullable<Config.Info["mcp"]>
  type McpEntry = NonNullable<Config.Info["mcp"]>[string]
  function isMcpConfigured(entry: McpEntry): entry is Config.Mcp {
    return typeof entry === "object" && entry !== null && "type" in entry
  }
  const personaServers = getAllPersonaMcpServers()
  type PersonaServerConfig = (typeof personaServers)[keyof typeof personaServers]

  function forceMcpEnabled(name: string, mcp: Config.Mcp): Config.Mcp {
    if (mcp.enabled !== false) return mcp
    log.warn("Ignoring enabled=false for MCP server; MCP servers are always on", { name })
    return {
      ...mcp,
      enabled: true,
    }
  }

  function resolveMcpConfigEntry(name: string, entry: McpEntry | undefined): Config.Mcp | undefined {
    if (!entry) return undefined
    if (isMcpConfigured(entry)) return forceMcpEnabled(name, entry)
    if (typeof entry !== "object" || entry === null || !("enabled" in entry)) return undefined
    const persona = (personaServers as Record<string, PersonaServerConfig>)[name]
    if (!persona) return undefined
    return forceMcpEnabled(name, {
      type: persona.type,
      command: Array.from(persona.command),
      enabled: (entry as { enabled: boolean }).enabled,
    })
  }

  function resolveRuntimeMcpConfig(name: string, config: McpConfigMap): Config.Mcp | undefined {
    const fromConfig = resolveMcpConfigEntry(name, config[name])
    if (fromConfig) return fromConfig

    const persona = (personaServers as Record<string, PersonaServerConfig>)[name]
    if (!persona) return undefined
    return forceMcpEnabled(name, {
      type: persona.type,
      command: Array.from(persona.command),
    })
  }

  function isLocalServer(name: string, config: McpConfigMap): boolean {
    const configured = resolveMcpConfigEntry(name, config[name])
    if (configured) return configured.type === "local"
    const persona = (personaServers as Record<string, PersonaServerConfig>)[name]
    return persona?.type === "local"
  }

  function resolveLocalCommand(
    serverName: string,
    mcp: z.infer<typeof Config.McpLocal>,
    agentCoreRoot: string,
  ): string[] | undefined {
    const forceBunRuntime = isBuiltinLocalServer(serverName)
    if (forceBunRuntime) {
      log.debug("using Bun runtime for built-in local MCP server", { serverName })
    }

    const pickSourceRuntime = (candidate: string): string[] => ["bun", "run", candidate]

    // Check if provided command exists (handles bundled __dirname paths that don't exist at runtime)
    if (mcp.command?.length && mcp.command[0]) {
      // For "bun run <file>" or similar, verify the file exists
      const scriptArg = mcp.command.find((arg, i) => i > 0 && arg.endsWith(".ts"))
      const normalizedScriptArg = scriptArg?.replace(/\\/g, "/")
      const bundledPathMismatch =
        Boolean(scriptArg) &&
        normalizedScriptArg?.includes("/$bunfs/root/src/") &&
        !normalizedScriptArg?.includes("/mcp/servers/")

      if (!scriptArg || (existsSync(scriptArg) && !bundledPathMismatch)) {
        if (forceBunRuntime && scriptArg) {
          return ["bun", "run", scriptArg]
        }
        return mcp.command
      }
      // Script doesn't exist, fall through to source resolution
      log.debug("command script not found, trying source paths", { serverName, script: scriptArg })
    }

    // Try to find the server file in source directories
    const roots = [Global.Path.source, agentCoreRoot]
    // Backwards compat: strip legacy "personas-" prefix if present
    const baseName = serverName.replace(/^personas-/, "")
    const candidates = [serverName, baseName]

    for (const root of roots) {
      for (const name of candidates) {
        const candidate = path.join(root, "src", "mcp", "servers", `${name}.ts`)
        if (existsSync(candidate)) {
          log.debug("resolved local command", { serverName, path: candidate })
          return pickSourceRuntime(candidate)
        }
      }
    }

    return undefined
  }

  function resolveLocalCommandVariants(serverName: string, command: string[] | undefined): string[][] {
    if (!command || command.length === 0) return []
    if (!isBuiltinLocalServer(serverName)) return [command]

    const resolveTsxRunner = (): string | undefined => {
      const roots = [getZeeRoot(), Global.Path.source, process.cwd()]
      for (const root of roots) {
        const candidate = path.join(root, "node_modules", ".bin", "tsx")
        if (existsSync(candidate)) return candidate
      }
      return undefined
    }

    const variants: string[][] = []
    const pushVariant = (candidate: string[]) => {
      if (candidate.length === 0) return
      const exists = variants.some(
        (existing) =>
          existing.length === candidate.length && existing.every((segment, index) => segment === candidate[index]),
      )
      if (!exists) variants.push(candidate)
    }

    pushVariant(command)

    const normalizedServerName = normalizeBuiltinLocalServerName(serverName)
    const supportsNodeFallback = LOCAL_NODE_FALLBACK_SERVERS.has(normalizedServerName)
    const tsxRunner = supportsNodeFallback ? resolveTsxRunner() : undefined

    // Built-in local MCP servers default to `bun run <script>.ts`; if that
    // runtime path is unstable, fall back to `bun <script>.ts`.
    const bunCmd = command[0]
    const scriptArg = command[2]
    if (bunCmd === "bun" && command[1] === "run" && typeof scriptArg === "string" && scriptArg.endsWith(".ts")) {
      pushVariant([bunCmd, ...command.slice(2)])

      // Portfolio has shown Bun runtime panics on some hosts; add a Node+tsx
      // loader fallback as a last resort while keeping the same server script.
      if (supportsNodeFallback) {
        if (tsxRunner) {
          pushVariant([tsxRunner, scriptArg])
        }
        pushVariant(["node", "--import", "tsx", scriptArg])
      }
      return variants
    }

    if (supportsNodeFallback) {
      const scriptCandidate = command.at(-1)
      if (typeof scriptCandidate === "string" && scriptCandidate.endsWith(".ts")) {
        if (tsxRunner) {
          pushVariant([tsxRunner, scriptCandidate])
        }
        pushVariant(["node", "--import", "tsx", scriptCandidate])
      }
    }

    return variants
  }

  const state = Instance.state(
    async () => {
      const cfg = await Config.get()
      // ALWAYS include all 4 persona MCP servers (required)
      const personaMcps = getAllPersonaMcpServers()
      const userConfig = cfg.mcp ?? {}

      // Merge: user config overrides persona defaults, but all 4 must exist
      const config: Record<string, Config.Mcp> = {}

      // Add all 4 persona MCPs first
      for (const [name, server] of Object.entries(personaMcps)) {
        const resolved = resolveMcpConfigEntry(name, userConfig[name])
        config[name] = resolved ?? {
          type: server.type,
          command: [...server.command], // Convert readonly to mutable
        }
      }

      // User config can override defaults. Persona shorthand {"enabled": ...} is accepted for compatibility.
      for (const [name, mcp] of Object.entries(userConfig)) {
        const resolved = resolveMcpConfigEntry(name, mcp)
        if (!resolved) {
          log.error("Ignoring MCP config entry without type", { key: name })
          continue
        }

        config[name] = resolved
      }

      const clients: Record<string, MCPClient> = {}
      const status: Record<string, Status> = {}

      await Promise.all(
        Object.entries(config).map(async ([key, mcp]) => {
          const resolved = resolveMcpConfigEntry(key, mcp)
          if (!resolved) {
            log.error("Ignoring MCP config entry without type", { key })
            return
          }

          const result = await create(key, resolved).catch(() => undefined)
          if (!result) return

          status[key] = result.status

          if (result.mcpClient) {
            clients[key] = result.mcpClient
          }
        }),
      )
      const healthTimer = setInterval(() => {
        void healthCheckAndReconnect().catch((error) => {
          log.debug("mcp health monitor check failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }, HEALTH_MONITOR_INTERVAL_MS)
      healthTimer.unref?.()
      return {
        status,
        clients,
        healthTimer,
      }
    },
    async (state) => {
      clearInterval(state.healthTimer)
      await Promise.all(
        Object.values(state.clients).map((client) =>
          client.close().catch((error) => {
            log.error("Failed to close MCP client", {
              error,
            })
          }),
        ),
      )
      pendingOAuthTransports.clear()
    },
  )

  // Helper function to fetch prompts for a specific client
  async function fetchPromptsForClient(clientName: string, client: Client) {
    const prompts = await client.listPrompts().catch((e) => {
      log.error("failed to get prompts", { clientName, error: e.message })
      return undefined
    })

    if (!prompts) {
      return
    }

    const commands: Record<string, PromptInfo & { client: string }> = {}

    for (const prompt of prompts.prompts) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedPromptName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = sanitizedClientName + ":" + sanitizedPromptName

      commands[key] = { ...prompt, client: clientName }
    }
    return commands
  }

  async function fetchResourcesForClient(clientName: string, client: Client) {
    const resources = await client.listResources().catch((e) => {
      log.error("failed to get prompts", { clientName, error: e.message })
      return undefined
    })

    if (!resources) {
      return
    }

    const commands: Record<string, ResourceInfo & { client: string }> = {}

    for (const resource of resources.resources) {
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const sanitizedResourceName = resource.name.replace(/[^a-zA-Z0-9_-]/g, "_")
      const key = sanitizedClientName + ":" + sanitizedResourceName

      commands[key] = { ...resource, client: clientName }
    }
    return commands
  }

  async function createLocalClientAttempt(
    key: string,
    mcp: z.infer<typeof Config.McpLocal>,
    commandOverride?: string[],
  ): Promise<{ mcpClient?: MCPClient; status: Status; tools?: MCPToolDef[]; error?: unknown }> {
    const cwd = Instance.directory
    // Ensure ZEE_ROOT is set for MCP servers that depend on it
    const zeeRoot = process.env.ZEE_ROOT || getZeeRoot()
    const resolvedCommand = commandOverride ?? resolveLocalCommand(key, mcp, zeeRoot)
    const [cmd, ...args] = resolvedCommand ?? []
    if (!cmd) {
      const error = "Missing command for local MCP server"
      log.error("local mcp startup failed", { key, command: mcp.command, cwd, error })
      return {
        mcpClient: undefined,
        status: { status: "failed", error },
        error: new Error(error),
      }
    }

    const stderrChunks: string[] = []
    let stderrBytes = 0

    const pushStderrChunk = (text: string) => {
      if (!text) return
      stderrChunks.push(text)
      stderrBytes += Buffer.byteLength(text)
      while (stderrBytes > LOCAL_STDERR_TAIL_MAX_BYTES && stderrChunks.length > 0) {
        const removed = stderrChunks.shift() ?? ""
        stderrBytes -= Buffer.byteLength(removed)
      }
    }

    const getStderrTail = (): string | undefined => {
      const tail = stderrChunks.join("").trim()
      return tail.length > 0 ? tail : undefined
    }

    const enrichLocalStartupError = (baseMessage: string): string => {
      const stderrTail = getStderrTail()
      if (!stderrTail) return baseMessage
      return `${baseMessage}\nMCP stderr: ${stderrTail}`
    }

    const transport = new StdioClientTransport({
      stderr: "pipe",
      command: cmd,
      args,
      cwd,
      env: {
        ...process.env,
        ZEE_ROOT: process.env.ZEE_ROOT || zeeRoot,
        ZEE_MCP_SERVER: "1",
        ZEE_MCP_SERVER_NAME: key,
        ZEE_PARENT_PID: String(process.pid),
        ...(cmd === "zee" ? { BUN_BE_BUN: "1" } : {}),
        ...mcp.environment,
      },
    })
    transport.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      pushStderrChunk(text)
      log.info(`mcp stderr: ${text}`, { key })
    })

    const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
    const client = new Client({
      name: "zee",
      version: Installation.VERSION,
    })

    try {
      await withTimeout(client.connect(transport), connectTimeout)
      registerNotificationHandlers(client, key)
      const listed = await withTimeout(client.listTools(), connectTimeout)
      return {
        mcpClient: client,
        status: { status: "connected" },
        tools: listed.tools,
      }
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : String(error)
      const detailedMessage = enrichLocalStartupError(baseMessage)
      await client.close().catch((closeError) => {
        log.debug("failed to close local MCP client after startup failure", {
          key,
          error: closeError instanceof Error ? closeError.message : String(closeError),
        })
      })
      return {
        mcpClient: undefined,
        status: {
          status: "failed",
          error: detailedMessage,
        },
        error: new Error(detailedMessage),
      }
    }
  }

  async function createLocalClientWithRetries(
    key: string,
    mcp: z.infer<typeof Config.McpLocal>,
  ): Promise<{ mcpClient?: MCPClient; status: Status; tools?: MCPToolDef[] }> {
    const now = Date.now()
    if (getActiveLocalCooldown(key, now)) {
      return {
        mcpClient: undefined,
        status: buildLocalFailureStatus(key, "crash_loop", "Local MCP server is cooling down", {
          cooldownActive: true,
          now,
        }),
      }
    }

    const totalAttempts = Math.max(1, Math.floor(localMcpResilienceConfig.startupMaxAttempts))
    const zeeRoot = process.env.ZEE_ROOT || getZeeRoot()
    const commandVariants = resolveLocalCommandVariants(key, resolveLocalCommand(key, mcp, zeeRoot))
    let commandVariantIndex = 0
    let consecutiveConnectionClosedFailures = 0

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      const localAttempt = await withLocalStartupGate(() =>
        createLocalClientAttempt(key, mcp, commandVariants[commandVariantIndex]),
      )
      if (localAttempt.mcpClient) {
        markLocalServerHealthy(key)
        return localAttempt
      }

      const statusError =
        "error" in localAttempt.status ? localAttempt.status.error : "Unknown local MCP startup failure"
      const classified = classifyLocalFailure(localAttempt.error ?? statusError)
      let failureClass: LocalFailureClass = classified.className
      if (classified.className === "connection_closed") {
        consecutiveConnectionClosedFailures += 1
        if (consecutiveConnectionClosedFailures >= 2) {
          failureClass = "runtime_crash"
        }
      } else {
        consecutiveConnectionClosedFailures = 0
      }
      const failureNow = Date.now()
      const health = registerLocalServerFailure(key, failureClass, classified.message, failureNow)
      const cooldownActive = Boolean(getActiveLocalCooldown(key, failureNow))

      if (cooldownActive) {
        log.warn("local MCP crash loop detected; entering cooldown", {
          key,
          failureClass,
          rawFailureClass: classified.className,
          failures: health.consecutiveFailures,
          cooldownUntil: health.cooldownUntil,
        })
        return {
          mcpClient: undefined,
          status: buildLocalFailureStatus(key, "crash_loop", classified.message, {
            cooldownActive: true,
            now: failureNow,
          }),
        }
      }

      const retryable = isRetryableLocalFailure(failureClass, classified.message)
      const shouldAdvanceVariant =
        attempt < totalAttempts &&
        commandVariants.length > 1 &&
        commandVariantIndex < commandVariants.length - 1 &&
        (failureClass === "runtime_crash" ||
          isBunRuntimeCrashMessage(classified.message) ||
          (retryable && commandVariantIndex === 0))
      if (shouldAdvanceVariant) {
        const fromCommand = commandVariants[commandVariantIndex] ?? []
        commandVariantIndex += 1
        const toCommand = commandVariants[commandVariantIndex] ?? []
        log.warn("local mcp startup switching command variant", {
          key,
          attempt,
          totalAttempts,
          commandVariantIndex,
          commandVariantCount: commandVariants.length,
          fromCommand,
          toCommand,
          failureClass,
          rawFailureClass: classified.className,
          error: classified.message,
        })
      }

      if (attempt >= totalAttempts || !retryable) {
        log.error("local mcp startup failed", {
          key,
          attempt,
          totalAttempts,
          failureClass,
          rawFailureClass: classified.className,
          error: classified.message,
        })
        return {
          mcpClient: undefined,
          status: buildLocalFailureStatus(key, failureClass, classified.message, {
            attempt,
            totalAttempts,
            now: failureNow,
          }),
        }
      }

      const delayMs = getLocalRetryDelayMs(key, attempt)
      log.warn("local mcp startup retry scheduled", {
        key,
        attempt,
        totalAttempts,
        delayMs,
        failureClass,
        rawFailureClass: classified.className,
        error: classified.message,
      })
      await sleepMs(delayMs)
    }

    return {
      mcpClient: undefined,
      status: { status: "failed", error: "Local MCP startup failed with unknown error" },
    }
  }

  export async function add(name: string, mcp: Config.Mcp) {
    // Use mutex to prevent concurrent state mutations for the same server
    return withServerMutex(name, async () => {
      const s = await state()
      const result = await create(name, mcp)
      if (!result) {
        const status = {
          status: "failed" as const,
          error: "unknown error",
        }
        s.status[name] = status
        return {
          status,
        }
      }
      if (!result.mcpClient) {
        s.status[name] = result.status
        return {
          status: s.status,
        }
      }
      // Close existing client if present to prevent memory leaks
      const existingClient = s.clients[name]
      if (existingClient) {
        await existingClient.close().catch((error) => {
          log.error("Failed to close existing MCP client", { name, error })
        })
      }
      s.clients[name] = result.mcpClient
      s.status[name] = result.status
      toolCache.delete(name)

      return {
        status: s.status,
      }
    })
  }

  async function create(key: string, inputMcp: Config.Mcp) {
    const mcp = forceMcpEnabled(key, inputMcp)
    log.info("found", { key, type: mcp.type })
    let mcpClient: MCPClient | undefined
    let discoveredTools: MCPToolDef[] | undefined
    let status: Status | undefined = undefined

    if (mcp.type === "remote") {
      // OAuth is enabled by default for remote servers unless explicitly disabled with oauth: false
      const oauthDisabled = mcp.oauth === false
      const oauthConfig = typeof mcp.oauth === "object" ? mcp.oauth : undefined
      let authProvider: McpOAuthProvider | undefined

      if (!oauthDisabled) {
        authProvider = new McpOAuthProvider(
          key,
          mcp.url,
          {
            clientId: oauthConfig?.clientId,
            clientSecret: oauthConfig?.clientSecret,
            scope: oauthConfig?.scope,
          },
          {
            onRedirect: async (url) => {
              log.info("oauth redirect requested", { key, url: url.toString() })
              // Store the URL - actual browser opening is handled by startAuth
            },
          },
        )
      }

      let resolvedHeaders: Record<string, string> | undefined
      try {
        resolvedHeaders = await resolveMcpHeaders(mcp.headers)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("mcp header auth resolution failed", { key, error: message })
        return {
          mcpClient: undefined,
          status: { status: "failed" as const, error: message },
        }
      }

      const transports: Array<{ name: string; transport: TransportWithAuth }> = [
        {
          name: "StreamableHTTP",
          transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
            authProvider,
            requestInit: resolvedHeaders ? { headers: resolvedHeaders } : undefined,
          }),
        },
        {
          name: "SSE",
          transport: new SSEClientTransport(new URL(mcp.url), {
            authProvider,
            requestInit: resolvedHeaders ? { headers: resolvedHeaders } : undefined,
          }),
        },
      ]

      let lastError: Error | undefined
      let usedTransportIndex = -1
      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      for (let i = 0; i < transports.length; i++) {
        const { name, transport } = transports[i]
        try {
          const client = new Client({
            name: "zee",
            version: Installation.VERSION,
          })
          await withTimeout(client.connect(transport), connectTimeout)
          registerNotificationHandlers(client, key)
          mcpClient = client
          usedTransportIndex = i
          log.info("connected", { key, transport: name })
          status = { status: "connected" }
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))

          // Handle OAuth-specific errors
          if (error instanceof UnauthorizedError) {
            log.info("mcp server requires authentication", { key, transport: name })

            // Check if this is a "needs registration" error
            if (lastError.message.includes("registration") || lastError.message.includes("client_id")) {
              status = {
                status: "needs_client_registration" as const,
                error: "Server does not support dynamic client registration. Please provide clientId in config.",
              }
              // Show toast for needs_client_registration
              Bus.publish(TuiEvent.ToastShow, {
                title: "MCP Authentication Required",
                message: `Server "${key}" requires a pre-registered client ID. Add clientId to your config.`,
                variant: "warning",
                duration: 8000,
              }).catch((e) => log.debug("failed to show toast", { error: e }))
            } else {
              // Store transport for later finishAuth call
              pendingOAuthTransports.set(key, transport)
              usedTransportIndex = i // Mark as used for OAuth
              status = { status: "needs_auth" as const }
              // Show toast for needs_auth
              Bus.publish(TuiEvent.ToastShow, {
                title: "MCP Authentication Required",
                message: `Server "${key}" requires authentication. Run: zee mcp auth ${key}`,
                variant: "warning",
                duration: 8000,
              }).catch((e) => log.debug("failed to show toast", { error: e }))
            }
            break
          }

          // Close failed transport to prevent resource leak
          transport.close?.().catch((e) => log.debug("failed to close transport", { key, transport: name, error: e }))

          log.debug("transport connection failed", {
            key,
            transport: name,
            url: mcp.url,
            error: lastError.message,
          })
          status = {
            status: "failed" as const,
            error: lastError.message,
          }
        }
      }

      // Clean up unused transports (ones we didn't try or that weren't used)
      for (let i = 0; i < transports.length; i++) {
        if (i !== usedTransportIndex) {
          const { name, transport } = transports[i]
          transport
            .close?.()
            .catch((e) => log.debug("failed to close unused transport", { key, transport: name, error: e }))
        }
      }
    }

    if (mcp.type === "local") {
      const localResult = await createLocalClientWithRetries(key, mcp)
      mcpClient = localResult.mcpClient
      status = localResult.status
      discoveredTools = localResult.tools
    }

    if (!status) {
      status = {
        status: "failed" as const,
        error: "Unknown error",
      }
    }

    if (!mcpClient) {
      return {
        mcpClient: undefined,
        status,
      }
    }

    if (!discoveredTools) {
      const listed = await withTimeout(mcpClient.listTools(), mcp.timeout ?? DEFAULT_TIMEOUT).catch((err) => {
        log.error("failed to get tools from client", { key, error: err })
        return undefined
      })
      if (!listed) {
        await mcpClient.close().catch((error) => {
          log.error("Failed to close MCP client", {
            error,
          })
        })
        status = {
          status: "failed",
          error: "Failed to get tools",
        }
        return {
          mcpClient: undefined,
          status: {
            status: "failed" as const,
            error: "Failed to get tools",
          },
        }
      }
      discoveredTools = listed.tools
    }

    // Seed tool cache from the listTools() call we already made
    toolCache.set(key, { tools: discoveredTools, cachedAt: Date.now() })
    log.info("create() successfully created client", { key, toolCount: discoveredTools.length })
    return {
      mcpClient,
      status,
    }
  }

  export async function status() {
    const s = await state()
    const cfg = await Config.get()
    const config: McpConfigMap = (cfg.mcp ?? {}) as McpConfigMap
    const result: Record<string, Status> = {}

    // Include all known MCP statuses from runtime state first (includes mandatory persona MCPs).
    for (const [key, item] of Object.entries(s.status)) {
      result[key] = item
    }

    // Include all configured MCPs from config as well, even if they are not currently in runtime state.
    for (const [key, mcp] of Object.entries(config)) {
      const resolved = resolveMcpConfigEntry(key, mcp)
      if (!resolved) continue
      result[key] = s.status[key] ?? { status: "failed", error: "MCP server not initialized yet" }
    }

    // Normalize local failure statuses for read-only reporting.
    const now = Date.now()
    for (const [name, current] of Object.entries(result)) {
      if (current.status !== "failed") continue
      if (!isLocalServer(name, config)) continue
      result[name] = normalizeLocalFailureStatusForRead(name, current, now)
    }

    return result
  }

  export async function clients() {
    return state().then((state) => state.clients)
  }

  export async function connect(name: string) {
    // Use mutex to prevent concurrent state mutations for the same server
    return withServerMutex(name, async () => {
      const cfg = await Config.get()
      const config: McpConfigMap = (cfg.mcp ?? {}) as McpConfigMap
      const resolved = resolveRuntimeMcpConfig(name, config)
      if (!resolved) {
        log.error("MCP config not found", { name })
        return
      }

      const result = await create(name, { ...resolved, enabled: true })

      if (!result) {
        const s = await state()
        s.status[name] = {
          status: "failed",
          error: "Unknown error during connection",
        }
        return
      }

      const s = await state()
      s.status[name] = result.status
      if (result.mcpClient) {
        // Close existing client if present to prevent memory leaks
        const existingClient = s.clients[name]
        if (existingClient) {
          await existingClient.close().catch((error) => {
            log.error("Failed to close existing MCP client", { name, error })
          })
        }
        s.clients[name] = result.mcpClient
      }
    })
  }

  export async function disconnect(name: string) {
    log.warn("MCP disconnect requested but ignored because MCP servers are mandatory", { name })
    const s = await state()
    if (s.status[name]?.status === "connected") return
    await connect(name)
  }

  /**
   * Check if an MCP server connection is healthy by attempting to list tools.
   * Returns true if connected and responsive, false otherwise.
   */
  export async function isHealthy(name: string, options?: { bypassCache?: boolean }): Promise<boolean> {
    const s = await state()
    const client = s.clients[name]

    if (!client) {
      return false
    }

    if (s.status[name]?.status !== "connected") {
      return false
    }

    // Skip listTools() ping if we have a recent cache entry (< 60s old)
    if (!options?.bypassCache) {
      const cached = toolCache.get(name)
      if (cached && Date.now() - cached.cachedAt < 60_000) {
        return true
      }
    }

    try {
      // Attempt a simple operation to verify connection is alive
      const result = await withTimeout(client.listTools(), 5000)
      toolCache.set(name, { tools: result.tools, cachedAt: Date.now() })
      if (localServerHealth.has(name)) {
        markLocalServerHealthy(name)
      }
      return true
    } catch (e) {
      log.warn("MCP health check failed", { name, error: e instanceof Error ? e.message : String(e) })
      return false
    }
  }

  /**
   * Reconnect to an MCP server that has failed or disconnected.
   * Returns the new status after reconnection attempt.
   */
  export async function reconnect(name: string): Promise<Status> {
    // Use mutex to prevent concurrent state mutations for the same server
    return withServerMutex(name, async () => {
      const cfg = await Config.get()
      const config: McpConfigMap = (cfg.mcp ?? {}) as McpConfigMap
      const resolved = resolveRuntimeMcpConfig(name, config)
      if (!resolved) {
        log.error("MCP config not found for reconnect", { name })
        return { status: "failed", error: "MCP config not found" }
      }

      const now = Date.now()
      if (resolved.type === "local" && getActiveLocalCooldown(name, now)) {
        const cooldownStatus = buildLocalFailureStatus(name, "crash_loop", "Local MCP server is cooling down", {
          cooldownActive: true,
          now,
        })
        const s = await state()
        s.status[name] = cooldownStatus
        return cooldownStatus
      }

      // Close existing client if any
      const s = await state()
      const existingClient = s.clients[name]
      if (existingClient) {
        await existingClient.close().catch((error) => {
          log.debug("Failed to close existing MCP client during reconnect", { name, error })
        })
        delete s.clients[name]
      }
      toolCache.delete(name)

      log.info("Attempting MCP reconnection", { name })

      // Create new connection
      const result = await create(name, { ...resolved, enabled: true })

      if (!result) {
        s.status[name] = { status: "failed", error: "Unknown error during reconnection" }
        return s.status[name]
      }

      s.status[name] = result.status
      if (result.mcpClient) {
        s.clients[name] = result.mcpClient
        log.info("MCP reconnection successful", { name })
      } else {
        log.warn("MCP reconnection failed", { name, status: result.status })
      }

      return result.status
    })
  }

  /**
   * Attempt to reconnect all failed MCP servers.
   * Returns a map of server names to their new statuses.
   */
  export async function reconnectAll(): Promise<Record<string, Status>> {
    const s = await state()
    const cfg = await Config.get()
    const config: McpConfigMap = (cfg.mcp ?? {}) as McpConfigMap
    const results: Record<string, Status> = {}
    const now = Date.now()

    for (const [name, currentStatus] of Object.entries(s.status)) {
      if (currentStatus.status === "failed" || currentStatus.status === "disabled") {
        if (isLocalServer(name, config) && getActiveLocalCooldown(name, now)) {
          const previousError = "error" in currentStatus ? currentStatus.error : "Local MCP cooling down"
          results[name] = buildLocalFailureStatus(name, "crash_loop", previousError, {
            cooldownActive: true,
            now,
          })
          continue
        }
        results[name] = await reconnect(name)
      } else {
        results[name] = currentStatus
      }
    }

    return results
  }

  /**
   * Check health of all connected MCPs and reconnect any that have failed.
   * This can be called periodically or after daemon restart.
   */
  export async function healthCheckAndReconnect(): Promise<Record<string, Status>> {
    const s = await state()
    const cfg = await Config.get()
    const config: McpConfigMap = (cfg.mcp ?? {}) as McpConfigMap
    const results: Record<string, Status> = {}
    const now = Date.now()

    for (const [name, currentStatus] of Object.entries(s.status)) {
      if (currentStatus.status === "connected") {
        // Check if still healthy
        const healthy = await isHealthy(name, { bypassCache: true })
        if (!healthy) {
          log.warn("MCP connection unhealthy, attempting reconnect", { name })
          results[name] = await reconnect(name)
        } else {
          results[name] = currentStatus
        }
      } else if (currentStatus.status === "failed") {
        if (isLocalServer(name, config) && getActiveLocalCooldown(name, now)) {
          results[name] = buildLocalFailureStatus(name, "crash_loop", currentStatus.error, {
            cooldownActive: true,
            now,
          })
          continue
        }
        // Attempt to reconnect failed connections
        results[name] = await reconnect(name)
      } else {
        results[name] = currentStatus
      }
    }

    return results
  }

  export async function tools() {
    const result: Record<string, Tool> = {}
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const clientsSnapshot = await clients()

    // Identify connected servers
    const connectedServers = Object.keys(clientsSnapshot).filter((name) => s.status[name]?.status === "connected")

    // Identify servers that need a fresh listTools() call (no cache entry)
    const uncachedServers = connectedServers.filter((name) => !toolCache.has(name))

    // Fetch uncached servers in parallel
    if (uncachedServers.length > 0) {
      const fetchResults = await Promise.allSettled(
        uncachedServers.map(async (clientName) => {
          const client = clientsSnapshot[clientName]
          let toolsResult = await client.listTools().catch((e) => {
            log.warn("failed to get tools, will attempt reconnect", { clientName, error: e.message })
            return undefined
          })

          // If initial fetch failed, attempt reconnection
          if (!toolsResult) {
            const reconnectStatus = await reconnect(clientName)
            if (reconnectStatus.status === "connected") {
              const newClient = s.clients[clientName]
              if (newClient) {
                toolsResult = await newClient.listTools().catch((e) => {
                  log.error("failed to get tools after reconnect", { clientName, error: e.message })
                  s.status[clientName] = {
                    status: "failed" as const,
                    error: e instanceof Error ? e.message : String(e),
                  }
                  delete s.clients[clientName]
                  return undefined
                })
              }
            }
          }

          if (toolsResult) {
            toolCache.set(clientName, { tools: toolsResult.tools, cachedAt: Date.now() })
          }
          return { clientName, tools: toolsResult?.tools }
        }),
      )

      for (const r of fetchResults) {
        if (r.status === "rejected") {
          log.error("parallel tool fetch failed", { error: r.reason })
        }
      }
    }

    // Build tool map from cached entries
    for (const clientName of connectedServers) {
      const cached = toolCache.get(clientName)
      if (!cached) continue

      const mcpConfig = config[clientName]
      const entry = isMcpConfigured(mcpConfig) ? mcpConfig : undefined
      const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
      const asyncEnabled = isAsyncServer(clientName, entry)
      const pollToolId = `${sanitizedClientName}_job_poll`

      for (const mcpTool of cached.tools) {
        const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
        const toolId = sanitizedToolName in result ? sanitizedClientName + "_" + sanitizedToolName : sanitizedToolName
        result[toolId] = convertMcpTool(mcpTool, clientName, {
          asyncEnabled,
          pollToolId,
        })
      }
      if (asyncEnabled) {
        result[pollToolId] = createJobPollTool(clientName, pollToolId)
      }
    }
    return result
  }

  export async function prompts() {
    const s = await state()
    const clientsSnapshot = await clients()

    const prompts = Object.fromEntries<PromptInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries((await fetchPromptsForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return prompts
  }

  export async function resources() {
    const s = await state()
    const clientsSnapshot = await clients()

    const result = Object.fromEntries<ResourceInfo & { client: string }>(
      (
        await Promise.all(
          Object.entries(clientsSnapshot).map(async ([clientName, client]) => {
            if (s.status[clientName]?.status !== "connected") {
              return []
            }

            return Object.entries((await fetchResourcesForClient(clientName, client)) ?? {})
          }),
        )
      ).flat(),
    )

    return result
  }

  export async function callTool(serverName: string, toolName: string, args: Record<string, unknown> = {}) {
    const s = await state()
    let client = s.clients[serverName]

    if (!client || s.status[serverName]?.status !== "connected") {
      const reconnectStatus = await reconnect(serverName)
      if (reconnectStatus.status !== "connected") {
        throw new Failed({ name: serverName })
      }
      client = s.clients[serverName]
    }

    if (!client) {
      throw new Failed({ name: serverName })
    }

    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const mcpConfig = config[serverName]
    const timeout =
      (mcpConfig && isMcpConfigured(mcpConfig) ? mcpConfig.timeout : undefined) ??
      cfg.experimental?.mcp_timeout ??
      DEFAULT_TIMEOUT
    try {
      return await client.callTool(
        {
          name: toolName,
          arguments: args ?? {},
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          timeout,
        },
      )
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        s.status[serverName] = { status: "needs_auth" }
      }
      throw error
    }
  }

  export async function getPrompt(clientName: string, name: string, args?: Record<string, string>) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName,
      })
      return undefined
    }

    const result = await client
      .getPrompt({
        name: name,
        arguments: args,
      })
      .catch((e) => {
        log.error("failed to get prompt from MCP server", {
          clientName,
          promptName: name,
          error: e.message,
        })
        return undefined
      })

    return result
  }

  export async function readResource(clientName: string, resourceUri: string) {
    const clientsSnapshot = await clients()
    const client = clientsSnapshot[clientName]

    if (!client) {
      log.warn("client not found for prompt", {
        clientName: clientName,
      })
      return undefined
    }

    const result = await client
      .readResource({
        uri: resourceUri,
      })
      .catch((e) => {
        log.error("failed to get prompt from MCP server", {
          clientName: clientName,
          resourceUri: resourceUri,
          error: e.message,
        })
        return undefined
      })

    return result
  }

  /**
   * Start OAuth authentication flow for an MCP server.
   * Returns the authorization URL that should be opened in a browser.
   */
  export async function startAuth(mcpName: string): Promise<{ authorizationUrl: string }> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]

    if (!mcpConfig) {
      throw new Error(`MCP server not found: ${mcpName}`)
    }

    if (!isMcpConfigured(mcpConfig)) {
      throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
    }

    if (mcpConfig.type !== "remote") {
      throw new Error(`MCP server ${mcpName} is not a remote server`)
    }

    if (mcpConfig.oauth === false) {
      throw new Error(`MCP server ${mcpName} has OAuth explicitly disabled`)
    }

    // Start the callback server
    await McpOAuthCallback.ensureRunning()

    // Generate and store a cryptographically secure state parameter BEFORE creating the provider
    // The SDK will call provider.state() to read this value
    const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    await McpAuth.updateOAuthState(mcpName, oauthState)

    // Create a new auth provider for this flow
    // OAuth config is optional - if not provided, we'll use auto-discovery
    const oauthConfig = typeof mcpConfig.oauth === "object" ? mcpConfig.oauth : undefined
    let capturedUrl: URL | undefined
    const authProvider = new McpOAuthProvider(
      mcpName,
      mcpConfig.url,
      {
        clientId: oauthConfig?.clientId,
        clientSecret: oauthConfig?.clientSecret,
        scope: oauthConfig?.scope,
      },
      {
        onRedirect: async (url) => {
          capturedUrl = url
        },
      },
    )

    // Create transport with auth provider
    const transport = new StreamableHTTPClientTransport(new URL(mcpConfig.url), {
      authProvider,
    })

    // Try to connect - this will trigger the OAuth flow
    try {
      const client = new Client({
        name: "zee",
        version: Installation.VERSION,
      })
      await client.connect(transport)
      // If we get here, we're already authenticated
      return { authorizationUrl: "" }
    } catch (error) {
      if (error instanceof UnauthorizedError && capturedUrl) {
        // Store transport for finishAuth
        pendingOAuthTransports.set(mcpName, transport)
        return { authorizationUrl: capturedUrl.toString() }
      }
      throw error
    }
  }

  /**
   * Complete OAuth authentication after user authorizes in browser.
   * Opens the browser and waits for callback.
   */
  export async function authenticate(mcpName: string): Promise<Status> {
    const { authorizationUrl } = await startAuth(mcpName)

    if (!authorizationUrl) {
      // Already authenticated
      const s = await state()
      return s.status[mcpName] ?? { status: "connected" }
    }

    // Get the state that was already generated and stored in startAuth()
    const oauthState = await McpAuth.getOAuthState(mcpName)
    if (!oauthState) {
      throw new Error("OAuth state not found - this should not happen")
    }

    const safeUrl = normalizeHttpUrl(authorizationUrl)
    if (!safeUrl) {
      throw new Error("OAuth authorization URL must be http(s)")
    }

    // The SDK has already added the state parameter to the authorization URL
    // We just need to open the browser
    log.info("opening browser for oauth", { mcpName, url: safeUrl, state: oauthState })

    // Register the callback BEFORE opening the browser to avoid race conditions
    // when the IdP has an active session and redirects immediately.
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState)
    try {
      const subprocess = await open(safeUrl)
      // The open package spawns a detached process and returns immediately.
      // We need to listen for errors which fire asynchronously:
      // - "error" event: command not found (ENOENT)
      // - "exit" with non-zero code: command exists but failed (e.g., no display)
      await new Promise<void>((resolve, reject) => {
        // Give the process a moment to fail if it's going to
        const timeout = setTimeout(() => resolve(), 500)
        subprocess.on("error", (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        subprocess.on("exit", (code) => {
          if (code !== null && code !== 0) {
            clearTimeout(timeout)
            reject(new Error(`Browser open failed with exit code ${code}`))
          }
        })
      })
    } catch (error) {
      // Browser opening failed (e.g., in remote/headless sessions like SSH, devcontainers)
      // Emit event so CLI can display the URL for manual opening
      log.warn("failed to open browser, user must open URL manually", { mcpName, error })
      Bus.publish(BrowserOpenFailed, { mcpName, url: safeUrl })
    }

    // Wait for callback using the already-registered promise
    const code = await callbackPromise

    // Validate and clear the state
    const storedState = await McpAuth.getOAuthState(mcpName)
    if (storedState !== oauthState) {
      await McpAuth.clearOAuthState(mcpName)
      throw new Error("OAuth state mismatch - potential CSRF attack")
    }

    await McpAuth.clearOAuthState(mcpName)

    // Finish auth
    return finishAuth(mcpName, code)
  }

  /**
   * Complete OAuth authentication with the authorization code.
   */
  export async function finishAuth(mcpName: string, authorizationCode: string): Promise<Status> {
    const transport = pendingOAuthTransports.get(mcpName)

    if (!transport) {
      throw new Error(`No pending OAuth flow for MCP server: ${mcpName}`)
    }

    try {
      // Call finishAuth on the transport
      await transport.finishAuth(authorizationCode)

      // Clear the code verifier after successful auth
      await McpAuth.clearCodeVerifier(mcpName)

      // Now try to reconnect
      const cfg = await Config.get()
      const mcpConfig = cfg.mcp?.[mcpName]

      if (!mcpConfig) {
        throw new Error(`MCP server not found: ${mcpName}`)
      }

      if (!isMcpConfigured(mcpConfig)) {
        throw new Error(`MCP server ${mcpName} is disabled or missing configuration`)
      }

      // Re-add the MCP server to establish connection
      pendingOAuthTransports.delete(mcpName)
      const result = await add(mcpName, mcpConfig)

      const statusRecord = result.status as Record<string, Status>
      return statusRecord[mcpName] ?? { status: "failed", error: "Unknown error after auth" }
    } catch (error) {
      log.error("failed to finish oauth", { mcpName, error })
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Remove OAuth credentials for an MCP server.
   */
  export async function removeAuth(mcpName: string): Promise<void> {
    await McpAuth.remove(mcpName)
    McpOAuthCallback.cancelPending(mcpName)
    pendingOAuthTransports.delete(mcpName)
    await McpAuth.clearOAuthState(mcpName)
    log.info("removed oauth credentials", { mcpName })
  }

  /**
   * Check if an MCP server supports OAuth (remote servers support OAuth by default unless explicitly disabled).
   */
  export async function supportsOAuth(mcpName: string): Promise<boolean> {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp?.[mcpName]
    if (!mcpConfig) return false
    if (!isMcpConfigured(mcpConfig)) return false
    return mcpConfig.type === "remote" && mcpConfig.oauth !== false
  }

  /**
   * Check if an MCP server has stored OAuth tokens.
   */
  export async function hasStoredTokens(mcpName: string): Promise<boolean> {
    const entry = await McpAuth.get(mcpName)
    return !!entry?.tokens
  }

  export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

  /**
   * Get the authentication status for an MCP server.
   */
  export async function getAuthStatus(mcpName: string): Promise<AuthStatus> {
    const hasTokens = await hasStoredTokens(mcpName)
    if (!hasTokens) return "not_authenticated"
    const expired = await McpAuth.isTokenExpired(mcpName)
    return expired ? "expired" : "authenticated"
  }

  /**
   * Clear the tool cache. Exported for testing.
   */
  export function clearToolCache() {
    toolCache.clear()
  }

  /**
   * Get tool cache entry for a server. Exported for testing.
   */
  export function getToolCacheEntry(serverName: string): ToolCacheEntry | undefined {
    return toolCache.get(serverName)
  }

  /**
   * Test helper: override local MCP resilience settings.
   */
  export function configureLocalMcpResilienceForTests(input: Partial<LocalMcpResilienceConfig>) {
    if (typeof input.startupMaxAttempts === "number") {
      localMcpResilienceConfig.startupMaxAttempts = Math.max(1, Math.floor(input.startupMaxAttempts))
    }
    if (Array.isArray(input.startupBackoffMs)) {
      localMcpResilienceConfig.startupBackoffMs = input.startupBackoffMs
        .map((value) => Math.max(0, Math.floor(value)))
        .filter((value) => Number.isFinite(value))
    }
    if (typeof input.crashLoopThreshold === "number") {
      localMcpResilienceConfig.crashLoopThreshold = Math.max(1, Math.floor(input.crashLoopThreshold))
    }
    if (typeof input.crashLoopWindowMs === "number") {
      localMcpResilienceConfig.crashLoopWindowMs = Math.max(1, Math.floor(input.crashLoopWindowMs))
    }
    if (typeof input.crashLoopCooldownMs === "number") {
      localMcpResilienceConfig.crashLoopCooldownMs = Math.max(0, Math.floor(input.crashLoopCooldownMs))
    }
  }

  /**
   * Test helper: reset local MCP resilience and health state.
   */
  export function resetLocalMcpResilienceForTests() {
    localMcpResilienceConfig = {
      ...defaultLocalMcpResilienceConfig,
      startupBackoffMs: [...defaultLocalMcpResilienceConfig.startupBackoffMs],
    }
    localServerHealth.clear()
  }
}
