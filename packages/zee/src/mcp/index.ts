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

  // Per-server mutex to prevent concurrent state mutations for the same server
  const serverMutexes = new Map<string, Promise<void>>()

  // Per-server tool cache -- invalidated on tools/list_changed, reconnect, disconnect, add
  type ToolCacheEntry = { tools: MCPToolDef[]; cachedAt: number }
  const toolCache = new Map<string, ToolCacheEntry>()

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

  async function resolveMcpHeaders(
    headers?: Record<string, string>,
  ): Promise<Record<string, string> | undefined> {
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

        const statusLine =
          job.status === "running"
            ? `Job ${job_id} is running.`
            : `Job ${job_id} is queued.`
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
  type McpEntry = NonNullable<Config.Info["mcp"]>[string]
  function isMcpConfigured(entry: McpEntry): entry is Config.Mcp {
    return typeof entry === "object" && entry !== null && "type" in entry
  }
  const personaServers = getAllPersonaMcpServers()
  type PersonaServerConfig = (typeof personaServers)[keyof typeof personaServers]

  function resolveMcpConfigEntry(name: string, entry: McpEntry | undefined): Config.Mcp | undefined {
    if (!entry) return undefined
    if (isMcpConfigured(entry)) return entry
    if (typeof entry !== "object" || entry === null || !("enabled" in entry)) return undefined
    const persona = (personaServers as Record<string, PersonaServerConfig>)[name]
    if (!persona) return undefined
    return {
      type: persona.type,
      command: Array.from(persona.command),
      enabled: (entry as { enabled: boolean }).enabled,
    }
  }

  function resolveLocalCommand(
    serverName: string,
    mcp: z.infer<typeof Config.McpLocal>,
    agentCoreRoot: string,
  ): string[] | undefined {
    // Check if provided command exists (handles bundled __dirname paths that don't exist at runtime)
    if (mcp.command?.length && mcp.command[0]) {
      // For "bun run <file>" or similar, verify the file exists
      const scriptArg = mcp.command.find((arg, i) => i > 0 && arg.endsWith(".ts"))
      if (!scriptArg || existsSync(scriptArg)) {
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
          return ["bun", "run", candidate]
        }
      }
    }

    return undefined
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

      // User config can override defaults. For persona MCPs, disabled shorthand is allowed.
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
      return {
        status,
        clients,
      }
    },
    async (state) => {
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

  async function create(key: string, mcp: Config.Mcp) {
    if (mcp.enabled === false) {
      log.info("mcp server disabled", { key })
      return {
        mcpClient: undefined,
        status: { status: "disabled" as const },
      }
    }

    log.info("found", { key, type: mcp.type })
    let mcpClient: MCPClient | undefined
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
          transport.close?.().catch((e) => log.debug("failed to close unused transport", { key, transport: name, error: e }))
        }
      }
    }

    if (mcp.type === "local") {
      const cwd = Instance.directory
      // Ensure ZEE_ROOT is set for MCP servers that depend on it
      const zeeRoot = process.env.ZEE_ROOT || getZeeRoot()
      const resolvedCommand = resolveLocalCommand(key, mcp, zeeRoot)
      const [cmd, ...args] = resolvedCommand ?? []
      if (!cmd) {
        const error = "Missing command for local MCP server"
        log.error("local mcp startup failed", { key, command: mcp.command, cwd, error })
        return {
          mcpClient: undefined,
          status: { status: "failed" as const, error },
        }
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
        log.info(`mcp stderr: ${chunk.toString()}`, { key })
      })

      const connectTimeout = mcp.timeout ?? DEFAULT_TIMEOUT
      try {
        const client = new Client({
          name: "zee",
          version: Installation.VERSION,
        })
        await withTimeout(client.connect(transport), connectTimeout)
        registerNotificationHandlers(client, key)
        mcpClient = client
        status = {
          status: "connected",
        }
      } catch (error) {
        log.error("local mcp startup failed", {
          key,
          command: mcp.command,
          cwd,
          error: error instanceof Error ? error.message : String(error),
        })
        status = {
          status: "failed" as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
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

    const result = await withTimeout(mcpClient.listTools(), mcp.timeout ?? DEFAULT_TIMEOUT).catch((err) => {
      log.error("failed to get tools from client", { key, error: err })
      return undefined
    })
    if (!result) {
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

    // Seed tool cache from the listTools() call we already made
    toolCache.set(key, { tools: result.tools, cachedAt: Date.now() })
    log.info("create() successfully created client", { key, toolCount: result.tools.length })
    return {
      mcpClient,
      status,
    }
  }

  export async function status() {
    const s = await state()
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const result: Record<string, Status> = {}

    // Include all configured MCPs from config, not just connected ones
    for (const [key, mcp] of Object.entries(config)) {
      const resolved = resolveMcpConfigEntry(key, mcp)
      if (!resolved) continue
      result[key] = s.status[key] ?? { status: "disabled" }
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
      const config = cfg.mcp ?? {}
      const mcp = config[name]
      if (!mcp) {
        log.error("MCP config not found", { name })
        return
      }

      const resolved = resolveMcpConfigEntry(name, mcp)
      if (!resolved) {
        log.error("Ignoring MCP connect request for config without type", { name })
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
    // Use mutex to prevent concurrent state mutations for the same server
    return withServerMutex(name, async () => {
      const s = await state()
      const client = s.clients[name]
      if (client) {
        await client.close().catch((error) => {
          log.error("Failed to close MCP client", { name, error })
        })
        delete s.clients[name]
      }
      toolCache.delete(name)
      s.status[name] = { status: "disabled" }
    })
  }

  /**
   * Check if an MCP server connection is healthy by attempting to list tools.
   * Returns true if connected and responsive, false otherwise.
   */
  export async function isHealthy(name: string): Promise<boolean> {
    const s = await state()
    const client = s.clients[name]

    if (!client) {
      return false
    }

    if (s.status[name]?.status !== "connected") {
      return false
    }

    // Skip listTools() ping if we have a recent cache entry (< 60s old)
    const cached = toolCache.get(name)
    if (cached && Date.now() - cached.cachedAt < 60_000) {
      return true
    }

    try {
      // Attempt a simple operation to verify connection is alive
      await withTimeout(client.listTools(), 5000)
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
      const mcpConfig = cfg.mcp?.[name]

      if (!mcpConfig) {
        log.error("MCP config not found for reconnect", { name })
        return { status: "failed", error: "MCP config not found" }
      }

      const resolved = resolveMcpConfigEntry(name, mcpConfig)
      if (!resolved) {
        log.error("MCP config invalid for reconnect", { name })
        return { status: "failed", error: "Invalid MCP configuration" }
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
    const results: Record<string, Status> = {}

    for (const [name, currentStatus] of Object.entries(s.status)) {
      if (currentStatus.status === "failed") {
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
    const results: Record<string, Status> = {}

    for (const [name, currentStatus] of Object.entries(s.status)) {
      if (currentStatus.status === "connected") {
        // Check if still healthy
        const healthy = await isHealthy(name)
        if (!healthy) {
          log.warn("MCP connection unhealthy, attempting reconnect", { name })
          results[name] = await reconnect(name)
        } else {
          results[name] = currentStatus
        }
      } else if (currentStatus.status === "failed") {
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
    const connectedServers = Object.keys(clientsSnapshot).filter(
      (name) => s.status[name]?.status === "connected",
    )

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
        const toolId = sanitizedToolName in result
          ? sanitizedClientName + "_" + sanitizedToolName
          : sanitizedToolName
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

  export async function callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ) {
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
}
