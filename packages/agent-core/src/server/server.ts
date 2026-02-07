import { BusEvent } from "@/bus/bus-event"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, resolver } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import fs from "fs/promises"
import os from "os"
import path from "path"

import { HTTPException } from "hono/http-exception"

import { proxy } from "hono/proxy"
import z from "zod"

import { Flag } from "@/flag/flag"
import { Provider } from "../provider/provider"
import { NamedError } from "@agent-core/util/error"
import { lazy } from "../util/lazy"
import { Storage } from "../storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { bodyLimit } from "hono/body-limit"

import { Config } from "../config/config"
import { Filesystem } from "../util/filesystem"
import { MDNS } from "./mdns"
import { ServerState } from "./state"
import { Instance } from "../project/instance"
import {
  AuthScope,
  assertSafeServerBind,
  getAuthConfig,
  hasScope,
  isAuthorized,
  isLoopbackHostname,
  resolveRequiredScope,
} from "./auth"

// Routes
import { ProjectRoute } from "./route/project"
import { QuestionRoute } from "./route/question"
import { GlobalRoute } from "./route/global"
import { AppRoute } from "./route/app"
import { PtyRoute } from "./route/pty"
import { ConfigRoute } from "./route/config"
import { InstanceRoute } from "./route/instance"
import { FilesystemRoute } from "./route/filesystem"
import { SessionRoute } from "./route/session"
import { PermissionRoute } from "./route/permission"
import { CommandRoute } from "./route/command"
import { ModelRoute } from "./route/model"
import { McpRoute } from "./route/mcp"
import { LspRoute } from "./route/lsp"
import { TuiRoute } from "./route/tui"
import { AuthRoute } from "./route/auth"
import { ToolRoute } from "./route/tool"
import { ProcessRoute } from "./route/process"
import { MemoryRoute } from "./route/memory"
import { UsageRoute } from "../usage/route"
import { GatewayRoute } from "./route/gateway"
import { SttRoute } from "./route/stt"
import { CronRoute } from "./route/cron"
import { HeartbeatRoute } from "./route/heartbeat"
import { RequestMeta } from "./request-meta"

// Default API port for the daemon
const DEFAULT_API_PORT = 3210
const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024
const DEFAULT_IDLE_TIMEOUT_SECONDS = 120
const DEFAULT_MAX_INSTANCES_NON_LOOPBACK = 64

function parseBodyLimitBytes(value?: string): number | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  const match = normalized.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/)
  if (!match) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  const unit = match[2] ?? "b"
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  }
  return Math.floor(amount * (multipliers[unit] ?? 1))
}

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  let _corsWhitelist: string[] = []
  let _isLoopbackBind = true

  /**
   * Reset in-memory server state. This is mainly used by tests to avoid cross-test leakage.
   */
  export function reset() {
    _corsWhitelist = []
    _isLoopbackBind = true
    App.reset()
  }

  function parseCommaList(value?: string): string[] {
    if (!value) return []
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }

  function expandHome(value: string): string {
    const trimmed = value.trim()
    if (trimmed === "~") return os.homedir()
    if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2))
    if (trimmed.startsWith("$HOME/")) return path.join(os.homedir(), trimmed.slice(6))
    if (trimmed === "$HOME") return os.homedir()
    return trimmed
  }

  async function normalizeAllowedDirectories(raw: string[], baseDir: string): Promise<string[]> {
    const result: string[] = []
    for (const item of raw) {
      const expanded = expandHome(item)
      const absolute = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(baseDir, expanded)
      const real = await fs.realpath(absolute).catch(() => absolute)
      const st = await fs.stat(real).catch(() => undefined)
      if (!st?.isDirectory()) continue
      result.push(real)
    }
    return Array.from(new Set(result))
  }

  export function url(): URL {
    return ServerState.url()
  }

  export const Event = {
    Connected: BusEvent.define("server.connected", z.object({})),
    Disposed: BusEvent.define("global.disposed", z.object({})),
  }

  export const App: (() => Hono) & { reset: () => void } = lazy(
    () =>
      new Hono()
        .onError((err, c) => {
          if (err instanceof HTTPException) {
            return err.getResponse()
          }
          log.error("failed", {
            error: err,
          })
          if (err instanceof NamedError) {
            let status: ContentfulStatusCode
            if (err instanceof Storage.NotFoundError) status = 404
            else if (err instanceof Provider.ModelNotFoundError) status = 400
            else if (err.name.startsWith("Worktree")) status = 400
            else status = 500
            return c.json(err.toObject(), { status })
          }
          // Sentinel: Prevent stack trace leakage in API responses
          const message = err instanceof Error ? err.message : String(err)
          return c.json(new NamedError.Unknown({ message }).toObject(), {
            status: 500,
          })
        })
        .use(async (c, next) => {
          const skipLogging = c.req.path === "/log"
          if (!skipLogging) {
            log.info("request", {
              method: c.req.method,
              path: c.req.path,
            })
          }
          const timer = log.time("request", {
            method: c.req.method,
            path: c.req.path,
          })
          await next()
          if (!skipLogging) {
            timer.stop()
          }
        })
        .use(
          bodyLimit({
            maxSize:
              parseBodyLimitBytes(process.env["AGENT_CORE_BODY_LIMIT"] ?? process.env["AGENT_CORE_BODY_LIMIT"]) ??
              DEFAULT_BODY_LIMIT_BYTES,
            onError: (c) => c.json({ error: "Request body too large" }, 413),
          }),
        )
        .use(
          cors({
            origin(input) {
              if (!input) return

              if (input.startsWith("http://localhost:")) return input
              if (input.startsWith("http://127.0.0.1:")) return input
              if (_corsWhitelist.includes(input)) {
                return input
              }

              return
            },
          }),
        )
        .use(async (c, next) => {
          if (c.req.method === "OPTIONS") {
            await next()
            return
          }

          const authConfig = getAuthConfig()
          if (!authConfig.disabled) {
            const ip = RequestMeta.getIp(c.req.raw)
            const method = c.req.method
            const path = c.req.path
            const required = resolveRequiredScope(method, path)
            const authHeader = c.req.header("Authorization")

            if (!isAuthorized(authHeader)) {
              log.warn("auth denied", {
                status: 401,
                ip,
                method,
                path,
                required,
              })
              c.header("WWW-Authenticate", 'Basic realm="agent-core"')
              return c.text("Unauthorized", 401)
            }

            const granted = authConfig.scopes ?? [AuthScope.ADMIN]
            if (!hasScope(granted, required)) {
              log.warn("authz denied", {
                status: 403,
                ip,
                method,
                path,
                required,
                granted,
              })
              return c.text("Forbidden", 403)
            }
          }
          await next()
        })
        // Middleware to provide instance context
        .use(async (c, next) => {
          if (c.req.path === "/log") return next()

          const baseDir = process.cwd()
          const requestedDirectory = c.req.query("directory") || c.req.header("x-opencode-directory")
          let directory = baseDir

          if (requestedDirectory) {
            const authConfig = getAuthConfig()
            const expanded = expandHome(requestedDirectory)
            const absolute = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(baseDir, expanded)
            const real = await fs.realpath(absolute).catch(() => absolute)
            const st = await fs.stat(real).catch(() => undefined)
            if (!st?.isDirectory()) {
              return c.json({ error: "Directory not found", directory: real }, 400)
            }

            const baseReal = await fs.realpath(baseDir).catch(() => baseDir)
            if (!authConfig.disabled && path.resolve(real) !== path.resolve(baseReal)) {
              const granted = authConfig.scopes ?? [AuthScope.ADMIN]
              if (!hasScope(granted, AuthScope.ADMIN)) {
                return c.text("Forbidden", 403)
              }
            }

            const root = path.parse(real).root
            const isRoot = path.resolve(real) === path.resolve(root)
            const globalConfig = await Config.global().catch(() => ({} as Config.Info))
            const allowGlobal =
              Flag.AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY || globalConfig?.server?.allowGlobalDirectory === true
            if (isRoot && !allowGlobal) {
              return c.json(
                {
                  error:
                    "Refusing to use filesystem root as instance directory. Set AGENT_CORE_SERVER_ALLOW_GLOBAL_DIRECTORY=1 or config.server.allowGlobalDirectory=true to override.",
                  directory: real,
                },
                400,
              )
            }

            if (!_isLoopbackBind) {
              const configAllowed = globalConfig?.server?.allowedDirectories ?? []
              const envAllowed = parseCommaList(process.env["AGENT_CORE_SERVER_ALLOWED_DIRECTORIES"])
              const rawAllowed = [...configAllowed, ...envAllowed]
              const allowedRoots =
                rawAllowed.length > 0 ? await normalizeAllowedDirectories(rawAllowed, baseDir) : [baseDir]

              const ok = allowedRoots.some((rootDir) => Filesystem.containsResolvedSync(rootDir, real))
              if (!ok) {
                return c.json(
                  {
                    error:
                      "Directory is not allowed in server mode. Configure AGENT_CORE_SERVER_ALLOWED_DIRECTORIES or config.server.allowedDirectories.",
                    directory: real,
                  },
                  403,
                )
              }
            }

            const maxInstances =
              Flag.AGENT_CORE_SERVER_MAX_INSTANCES ??
              globalConfig?.server?.maxInstances ??
              (!_isLoopbackBind ? DEFAULT_MAX_INSTANCES_NON_LOOPBACK : undefined)
            if (maxInstances && !Instance.isCached(real) && Instance.cacheSize() >= maxInstances) {
              return c.json(
                {
                  error:
                    "Instance cache limit reached. Refusing to create a new instance directory for this request. " +
                    "Dispose unused instances (POST /instance/dispose?directory=...) or increase server.maxInstances / AGENT_CORE_SERVER_MAX_INSTANCES.",
                  directory: real,
                  maxInstances,
                  currentInstances: Instance.cacheSize(),
                },
                429,
              )
            }

            directory = real
          }

          return Instance.provide({
            directory,
            fn: async () => {
              await next()
            },
          })
        })
        
        // Mount Routes
        .route("/", AppRoute)
        .route("/global", GlobalRoute)
        .route("/pty", PtyRoute)
        .route("/", ConfigRoute)
        .route("/", InstanceRoute)
        .route("/", FilesystemRoute)
        .route("/", SessionRoute)
        .route("/permission", PermissionRoute)
        .route("/command", CommandRoute)
        .route("/", ModelRoute)
        .route("/mcp", McpRoute)
        .route("/", LspRoute)
        .route("/tui", TuiRoute)
        .route("/auth", AuthRoute)
        .route("/", ToolRoute) // /experimental/tool
        .route("/question", QuestionRoute)
        .route("/project", ProjectRoute)
        .route("/", ProcessRoute)
        .route("/", MemoryRoute)
        .route("/usage", UsageRoute)
        .route("/gateway", GatewayRoute)
        .route("/stt", SttRoute)
        .route("/", CronRoute)
        .route("/", HeartbeatRoute)

        // API Documentation
        .get(
          "/openapi",
          describeRoute({
            summary: "Get OpenAPI specs",
            description: "Get the OpenAPI specifications for the API.",
            operationId: "openapi.specs",
            responses: {
              200: {
                description: "OpenAPI specs",
                content: {
                  "application/json": {
                    schema: resolver(z.any()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await openapi())
          },
        )

        
        // Proxy Fallback - MUST BE LAST
        .all("/*", async (c) => {
          const proxyBase = (process.env["AGENT_CORE_PROXY_BASE_URL"] ?? process.env["AGENT_CORE_PROXY_BASE_URL"] ?? "")
            .replace(/\/+$/, "")
          if (!proxyBase) {
            return c.text("Not Found", 404)
          }
          let proxyUrl: URL
          try {
            proxyUrl = new URL(c.req.path, proxyBase)
          } catch {
            return c.text("Not Found", 404)
          }

          // Sentinel: Prevent SSRF by ensuring the proxy target matches the configured origin
          try {
            const allowed = new URL(proxyBase)
            if (proxyUrl.origin !== allowed.origin) {
              return c.text("Forbidden", 403)
            }
          } catch {
            return c.text("Not Found", 404)
          }

          const response = await proxy(proxyUrl.toString(), {
            ...c.req,
            headers: {
              ...c.req.raw.headers,
              host: proxyUrl.host,
            },
          })
          response.headers.set(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:",
          )
          return response
        }) as unknown as Hono,
  )

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App() as Hono, {
      documentation: {
        info: {
          title: "agent-core",
          version: "1.0.0",
          description: "agent-core api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  /**
   * mDNS configuration options - supports both boolean shorthand and detailed object.
   */
  type MdnsOption = boolean | { enabled?: boolean; minimal?: boolean }

  /**
   * Resolve mDNS configuration from the flexible format.
   */
  function resolveMdnsConfig(mdns?: MdnsOption): { enabled: boolean; minimal: boolean } {
    if (mdns === undefined || mdns === false) {
      return { enabled: false, minimal: false }
    }
    if (mdns === true) {
      return { enabled: true, minimal: false }
    }
    return {
      enabled: mdns.enabled ?? true,
      minimal: mdns.minimal ?? false,
    }
  }

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: MdnsOption
    mdnsDomain?: string
    cors?: string[]
  }) {
    const prevCorsWhitelist = _corsWhitelist
    const prevIsLoopbackBind = _isLoopbackBind
    const nextCorsWhitelist = opts.cors ?? []
    const nextIsLoopbackBind = isLoopbackHostname(opts.hostname)
    let mdnsPublished = false

    // Avoid mutating global server state if we reject the bind.
    assertSafeServerBind({ hostname: opts.hostname })

    const idleTimeout = Flag.AGENT_CORE_SERVER_IDLE_TIMEOUT_SECONDS ?? DEFAULT_IDLE_TIMEOUT_SECONDS
    const args = {
      hostname: opts.hostname,
      idleTimeout,
      fetch: (req: Request, server: any) => {
        try {
          const ip = server?.requestIP?.(req)?.address
          RequestMeta.setIp(req, ip)
        } catch {
          // Ignore - request metadata is best-effort.
        }
        return App().fetch(req)
      },
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(DEFAULT_API_PORT) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    try {
      // Only update these after the bind guard and server startup succeed to avoid
      // polluting request middleware state when listen() throws (tests, CLI errors).
      _corsWhitelist = nextCorsWhitelist
      _isLoopbackBind = nextIsLoopbackBind

      ServerState.setUrl(server.url)

      const mdnsConfig = resolveMdnsConfig(opts.mdns)
      const isLoopback = opts.hostname === "127.0.0.1" || opts.hostname === "localhost" || opts.hostname === "::1"
      const shouldPublishMDNS = mdnsConfig.enabled && server.port && !isLoopback

      if (shouldPublishMDNS) {
        MDNS.publish({ port: server.port!, minimal: mdnsConfig.minimal, domain: opts.mdnsDomain })
        mdnsPublished = true
      } else if (mdnsConfig.enabled && isLoopback) {
        log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
      }

      const originalStop = server.stop.bind(server)
      server.stop = async (closeActiveConnections?: boolean) => {
        if (shouldPublishMDNS) MDNS.unpublish()
        return originalStop(closeActiveConnections)
      }

      return server
    } catch (err) {
      _corsWhitelist = prevCorsWhitelist
      _isLoopbackBind = prevIsLoopbackBind
      if (mdnsPublished) {
        try {
          MDNS.unpublish()
        } catch {
          // Ignore - best effort.
        }
      }
      try {
        // Best effort: avoid leaving a running server around when initialization fails.
        void server.stop(true)
      } catch {
        // Ignore - best effort.
      }
      throw err
    }
  }
}
