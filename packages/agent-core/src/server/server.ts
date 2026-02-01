import { BusEvent } from "@/bus/bus-event"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, resolver } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"

import { HTTPException } from "hono/http-exception"

import { proxy } from "hono/proxy"
import z from "zod"

import { Provider } from "../provider/provider"
import { NamedError } from "@opencode-ai/util/error"
import { lazy } from "../util/lazy"
import { Storage } from "../storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { bodyLimit } from "hono/body-limit"

import { MDNS } from "./mdns"
import { ServerState } from "./state"
import { Instance } from "../project/instance"
import { isAuthorized } from "./auth"

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

// Default API port for the daemon
const DEFAULT_API_PORT = 3210
const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024

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
              parseBodyLimitBytes(process.env["AGENT_CORE_BODY_LIMIT"] ?? process.env["OPENCODE_BODY_LIMIT"]) ??
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
          // Auth disabled by default. Enable with AGENT_CORE_ENABLE_SERVER_AUTH=1 + AGENT_CORE_SERVER_PASSWORD
          if (!isAuthorized(c.req.header("Authorization"))) {
            c.header("WWW-Authenticate", 'Basic realm="agent-core"')
            return c.text("Unauthorized", 401)
          }
          await next()
        })
        // Middleware to provide instance context
        .use(async (c, next) => {
          let directory = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
          // If directory is relative, make it absolute ensuring it starts with /
          // This fixes an issue where ?directory=foo/bar was treating it as relative to CWD
          // but we want it relative to root if it starts with /
          // Actually, process.cwd() is absolute.
          // If user passes query dir, we assume it's the intended workspace.
          
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
          const proxyBase = (process.env["AGENT_CORE_PROXY_BASE_URL"] ?? process.env["OPENCODE_PROXY_BASE_URL"] ?? "")
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
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self'",
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

  export function listen(opts: { port: number; hostname: string; mdns?: MdnsOption; cors?: string[] }) {
    _corsWhitelist = opts.cors ?? []

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
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

    ServerState.setUrl(server.url)

    const mdnsConfig = resolveMdnsConfig(opts.mdns)
    const isLoopback = opts.hostname === "127.0.0.1" || opts.hostname === "localhost" || opts.hostname === "::1"
    const shouldPublishMDNS = mdnsConfig.enabled && server.port && !isLoopback

    if (shouldPublishMDNS) {
      MDNS.publish({ port: server.port!, minimal: mdnsConfig.minimal })
    } else if (mdnsConfig.enabled && isLoopback) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
