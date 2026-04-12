import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { z } from "zod"
import { streamSSE } from "hono/streaming"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../project/instance"
import { Provider } from "@/provider/provider"
import { Installation } from "@/installation"
import { getGatewayHealthState } from "@/gateway/supervisor-state"
import { withTimeout } from "@/util/timeout"
import { SseLimit } from "../sse-limit"
import { registerSseKeepalive } from "../sse-keepalive"

// Health status schema for system monitoring
const HealthStatus = z.object({
  internet: z.enum(["ok", "fail", "checking"]),
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["ok", "fail", "skip"]),
    }),
  ),
  memory: z.object({
    status: z.enum(["ok", "fail"]),
    error: z.string().optional(),
  }),
})
const HealthCheck = z.object({
  healthy: z.boolean(),
  memory: z.object({
    status: z.enum(["ok", "fail"]),
    error: z.string().optional(),
  }),
  version: z.string(),
  channel: z.string(),
  mode: z.enum(["source", "binary"]),
  execPath: z.string(),
  entry: z.string().optional(),
  pid: z.number(),
  packageVersion: z.string().optional(),
  execModifiedAt: z.string().optional(),
  execModifiedTs: z.number().optional(),
  entryModifiedAt: z.string().optional(),
  entryModifiedTs: z.number().optional(),
})

const HealthLiveCheck = z.object({
  alive: z.literal(true),
  pid: z.number(),
  version: z.string(),
  mode: z.enum(["source", "binary"]),
})

const ServerStats = z.object({
  instances: z.object({
    cached: z.number().int().nonnegative(),
  }),
  sse: z.object({
    activeTotal: z.number().int().nonnegative(),
    activeClients: z.number().int().nonnegative(),
    maxTotal: z.number().int().positive(),
    maxPerClient: z.number().int().positive(),
  }),
})

const MEMORY_CHECK_TTL_MS = 30_000
let memoryHealthCache: { status: "ok" | "fail"; error?: string; checkedAt: number } | null = null

async function checkMemoryHealth(): Promise<{ status: "ok" | "fail"; error?: string }> {
  const now = Date.now()
  if (memoryHealthCache && now - memoryHealthCache.checkedAt < MEMORY_CHECK_TTL_MS) {
    return memoryHealthCache
  }

  let status: "ok" | "fail" = "ok"
  let error: string | undefined

  try {
    const { getMemory } = await import("../../../../../src/memory/unified")
    const memory = getMemory()
    await withTimeout(memory.stats(), 5000)
    const operational =
      typeof memory.isOperational === "function"
        ? memory.isOperational()
        : typeof memory.isAvailable === "function"
          ? memory.isAvailable()
          : true
    if (!operational) {
      status = "fail"
      error = "Memory backend unavailable"
    }
  } catch (err) {
    status = "fail"
    error = err instanceof Error ? err.message : String(err)
  }

  memoryHealthCache = { status, error, checkedAt: now }
  return memoryHealthCache
}

export const GlobalRoute = new Hono()
  .get(
    "/health/live",
    describeRoute({
      summary: "Liveness check",
      description: "Check if the server process is alive without dependency checks.",
      operationId: "health.live",
      responses: {
        200: {
          description: "Liveness check passed",
          content: {
            "application/json": {
              schema: resolver(HealthLiveCheck),
            },
          },
        },
      },
    }),
    async (c) => {
      const runtime = Installation.runtimeInfo()
      return c.json({
        alive: true as const,
        pid: runtime.pid,
        version: runtime.version,
        mode: runtime.mode,
      })
    },
  )
  .get(
    "/health",
    describeRoute({
      summary: "Health check",
      description: "Check if the server is running and healthy.",
      operationId: "health.check",
      responses: {
        200: {
          description: "Health check passed",
          content: {
            "application/json": {
              schema: resolver(HealthCheck),
            },
          },
        },
      },
    }),
    async (c) => {
      const runtime = Installation.runtimeInfo()
      const memory = await checkMemoryHealth()
      const gateway = getGatewayHealthState()
      return c.json({
        healthy: memory.status === "ok",
        memory,
        ...runtime,
        gateway,
      })
    },
  )
  .get(
    "/health/status",
    describeRoute({
      summary: "System health status",
      description: "Get internet connectivity and LLM provider status for system monitoring.",
      operationId: "health.status",
      responses: {
        200: {
          description: "Health status",
          content: {
            "application/json": {
              schema: resolver(HealthStatus),
            },
          },
        },
      },
    }),
    async (c) => {
      // Check internet connectivity
      let internet: "ok" | "fail" | "checking" = "checking"
      try {
        const controller = new AbortController()
        const timeout = setTimeout(controller.abort.bind(controller), 3000)
        const response = await fetch("https://cloudflare.com/cdn-cgi/trace", {
          method: "HEAD",
          signal: controller.signal,
        })
        clearTimeout(timeout)
        internet = response.ok || response.status < 500 ? "ok" : "fail"
      } catch {
        internet = "fail"
      }

      // Get configured providers and their connection status
      // Provider.list() returns Record<string, Provider.Info> of loaded providers
      const loadedProviders = await Provider.list()

      const providers = Object.values(loadedProviders).map((p) => ({
        id: p.id,
        name: p.name,
        status: "ok" as "ok" | "fail" | "skip",
      }))

      const memory = await checkMemoryHealth()

      return c.json({ internet, providers, memory })
    },
  )
  .get(
    "/stats",
    describeRoute({
      summary: "Server stats",
      description: "Get basic server stats (instance cache size and streaming connection counts).",
      operationId: "global.stats",
      responses: {
        200: {
          description: "Server stats",
          content: {
            "application/json": {
              schema: resolver(ServerStats),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({
        instances: {
          cached: Instance.cacheSize(),
        },
        sse: SseLimit.stats(),
      })
    },
  )
  .get(
    "/instances",
    describeRoute({
      summary: "List cached instances",
      description: "List cached Zee instance directories currently held in-process.",
      operationId: "global.instances",
      responses: {
        200: {
          description: "List of cached instance directories",
          content: {
            "application/json": {
              schema: resolver(z.array(z.string())),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(Instance.cachedDirectories())
    },
  )
  .get(
    "/event",
    describeRoute({
      summary: "Global event stream (SSE)",
      description:
        "Subscribe to all global events via Server-Sent Events. Useful for dashboards and cross-platform monitoring.",
      operationId: "event.global",
      responses: {
        200: {
          description: "Event stream (text/event-stream)",
        },
      },
    }),
    async (c) => {
      const slot = SseLimit.acquire(c.req.raw)
      if (!slot.ok) {
        return c.json({ error: slot.error }, slot.status)
      }

      try {
        return streamSSE(c, async (stream) => {
          const subscriptions: (() => void)[] = []
          const unregisterKeepalive = registerSseKeepalive(stream)

          try {
            // Pass through all events from the bus
            const handler = async (event: { directory?: string; payload: any }) => {
              const payload = {
                type: event.payload.type,
                properties: event.payload.properties,
              }
              await stream.writeSSE({
                event: event.payload.type,
                data: JSON.stringify({
                  directory: event.directory,
                  type: payload.type,
                  properties: payload.properties,
                  payload,
                }),
              })
            }
            GlobalBus.on("event", handler)
            subscriptions.push(() => GlobalBus.off("event", handler))

            // Send initial state
            await stream.writeSSE({
              event: "connected",
              data: JSON.stringify({ timestamp: Date.now() }),
            })

            stream.onAbort(() => {
              slot.release()
              unregisterKeepalive()
              subscriptions.forEach((unsub) => unsub())
            })

            await new Promise(() => {})
          } catch (err) {
            unregisterKeepalive()
            throw err
          }
        })
      } catch (err) {
        slot.release()
        throw err
      }
    },
  )
  .post(
    "/dispose-directory",
    describeRoute({
      summary: "Dispose cached instance by directory",
      description: "Dispose a cached Zee instance by directory key. Use /global/instances to discover cached keys.",
      operationId: "global.disposeDirectory",
      responses: {
        200: {
          description: "Dispose result",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        directory: z.string(),
      }),
    ),
    async (c) => {
      const { directory } = c.req.valid("json")
      const disposed = await Instance.disposeDirectory(directory)
      return c.json(disposed)
    },
  )
  .post(
    "/dispose-all",
    describeRoute({
      summary: "Dispose all cached instances",
      description: "Dispose all cached Zee instances held in-process.",
      operationId: "global.disposeAll",
      responses: {
        200: {
          description: "Dispose completed",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    async (c) => {
      await Instance.disposeAll()
      return c.json(true)
    },
  )
  .post(
    "/dispose",
    describeRoute({
      summary: "Dispose instance",
      description: "Clean up and dispose the current Zee instance, releasing all resources.",
      operationId: "instance.dispose",
      responses: {
        200: {
          description: "Instance disposed",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    async (c) => {
      await Instance.dispose()
      return c.json(true)
    },
  )
