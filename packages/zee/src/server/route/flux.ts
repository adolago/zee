import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { FluxRecorder } from "@/flux"

const FluxEventSchema = z
  .object({
    id: z.string(),
    timestamp: z.number(),
    traceID: z.string(),
    requestID: z.string().optional(),
    sessionID: z.string().optional(),
    messageID: z.string().optional(),
    providerID: z.string().optional(),
    modelID: z.string().optional(),
    direction: z.string(),
    domain: z.string(),
    kind: z.string(),
    status: z.string(),
    method: z.string().optional(),
    path: z.string().optional(),
    route: z.string().optional(),
    host: z.string().optional(),
    url: z.string().optional(),
    statusCode: z.number().optional(),
    latencyMs: z.number().optional(),
    bytesIn: z.number().optional(),
    bytesOut: z.number().optional(),
    token: z
      .object({
        input: z.number().optional(),
        output: z.number().optional(),
        cacheRead: z.number().optional(),
        cacheWrite: z.number().optional(),
        reasoning: z.number().optional(),
        total: z.number().optional(),
      })
      .optional(),
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
        retryable: z.boolean().optional(),
      })
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const FluxListResponseSchema = z.object({
  events: z.array(FluxEventSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  stats: z.object({
    total: z.number(),
    traceCount: z.number(),
    sessionCount: z.number(),
  }),
})

const FluxSessionPathSchema = z.object({
  sessionID: z.string(),
  traces: z.array(z.string()),
  events: z.array(FluxEventSchema),
  totals: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    reasoning: z.number(),
    total: z.number(),
  }),
})

export const FluxRoute = new Hono()
  .get(
    "/v1/flux/events",
    describeRoute({
      summary: "List flux events",
      description: "List token/API ingress-egress events with filters.",
      operationId: "flux.events",
      responses: {
        200: {
          description: "Flux events",
          content: {
            "application/json": {
              schema: resolver(FluxListResponseSchema),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        traceID: z.string().optional(),
        sessionID: z.string().optional(),
        domain: z.string().optional(),
        kind: z.string().optional(),
        from: z.coerce.number().optional(),
        to: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query")
      const result = FluxRecorder.list({
        traceID: query.traceID,
        sessionID: query.sessionID,
        domain: query.domain as any,
        kind: query.kind as any,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
      })
      return c.json(result)
    },
  )
  .get(
    "/v1/flux/trace/:traceID",
    describeRoute({
      summary: "Get trace path",
      description: "Get ordered flux events for one trace.",
      operationId: "flux.trace",
      responses: {
        200: {
          description: "Trace events",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  traceID: z.string(),
                  events: z.array(FluxEventSchema),
                }),
              ),
            },
          },
        },
      },
    }),
    validator(
      "param",
      z.object({
        traceID: z.string(),
      }),
    ),
    async (c) => {
      const { traceID } = c.req.valid("param")
      return c.json({
        traceID,
        events: FluxRecorder.trace(traceID),
      })
    },
  )
  .get(
    "/v1/flux/sessions/:sessionID/path",
    describeRoute({
      summary: "Get session flux path",
      description: "Get session-level token and API in/out path with totals.",
      operationId: "flux.session.path",
      responses: {
        200: {
          description: "Session path",
          content: {
            "application/json": {
              schema: resolver(FluxSessionPathSchema),
            },
          },
        },
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: z.string(),
      }),
    ),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      return c.json(FluxRecorder.sessionPath(sessionID))
    },
  )
  .get(
    "/v1/flux/schema",
    describeRoute({
      summary: "Get flux schema",
      description: "Get current flux event schema metadata and redaction settings.",
      operationId: "flux.schema",
      responses: {
        200: {
          description: "Flux schema",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), z.unknown())),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(FluxRecorder.schema())
    },
  )
