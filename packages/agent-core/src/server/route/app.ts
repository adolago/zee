import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { z } from "zod"
import { streamSSE } from "hono/streaming"
import { GlobalBus } from "@/bus/global"
import { Log } from "../../util/log"
import { Agent } from "../../agent/agent"
import { errors } from "../error"
import { SseLimit } from "../sse-limit"
import { registerSseKeepalive } from "../sse-keepalive"

export const AppRoute = new Hono()
  .get(
    "/event",
    describeRoute({
      summary: "Subscribe to events",
      description: "Get events",
      operationId: "event.subscribe",
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
            const handler = async (event: { directory?: string; payload: any }) => {
              const payload = {
                type: event.payload.type,
                properties: event.payload.properties,
              }
              await stream.writeSSE({
                event: event.payload.type,
                // Include legacy and payload shapes for SDK compatibility.
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
    "/log",
    describeRoute({
      summary: "Write log",
      description: "Write a log entry to the server logs with specified level and metadata.",
      operationId: "app.log",
      responses: {
        200: {
          description: "Log entry written successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.object({
        service: z.string().meta({ description: "Service name for the log entry" }),
        level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
        message: z.string().meta({ description: "Log message" }),
        extra: z.record(z.string(), z.any()).optional().meta({ description: "Additional metadata for the log entry" }),
      }),
    ),
    async (c) => {
      const { service, level, message, extra } = c.req.valid("json")
      const logger = Log.create({ service })

      switch (level) {
        case "debug":
          logger.debug(message, extra)
          break
        case "info":
          logger.info(message, extra)
          break
        case "error":
          logger.error(message, extra)
          break
        case "warn":
          logger.warn(message, extra)
          break
      }

      return c.json(true)
    },
  )
  .get(
    "/agent",
    describeRoute({
      summary: "List agents",
      description: "Get a list of all available AI agents in the agent-core system.",
      operationId: "app.agents",
      responses: {
        200: {
          description: "List of agents",
          content: {
            "application/json": {
              schema: resolver(Agent.Info.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      const modes = await Agent.list()
      return c.json(modes)
    },
  )
