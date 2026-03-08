import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { Config } from "../../config/config"
import { errors } from "../error"
import { isLoopbackHostname } from "../auth"
import { Log } from "../../util/log"
import { getNodeClientRegistry, resolveNodeClientPolicy } from "@/gateway/node-client-registry"

const log = Log.create({ service: "server:gateway-node" })

const NodePlatformSchema = z.enum(["macos", "ios", "android", "linux", "windows", "unknown"])

const NodePublicRecordSchema = z.object({
  id: z.string(),
  label: z.string(),
  platform: NodePlatformSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  lastSeenAt: z.number().optional(),
  status: z.enum(["paired", "revoked"]),
  revokedAt: z.number().optional(),
  revokeReason: z.string().optional(),
  metadata: z.record(z.string(), z.string()),
  toolAllowlist: z.array(z.string()),
})

const NodePairRequestSchema = z.object({
  label: z.string().min(1).max(120),
  platform: NodePlatformSchema.default("macos"),
  metadata: z.record(z.string(), z.string()).optional(),
  toolAllowlist: z.array(z.string()).optional(),
})

const NodePairResponseSchema = z.object({
  node: NodePublicRecordSchema,
  token: z.string(),
  policy: z.object({
    securityMode: z.enum(["deny", "allowlist", "full"]),
    maxPairedNodes: z.number(),
  }),
})

const NodeReconnectRequestSchema = z.object({
  nodeId: z.string().min(1),
  token: z.string().min(1),
})

const NodeRevokeRequestSchema = z.object({
  nodeId: z.string().min(1),
  reason: z.string().optional(),
})

const NodeToolAuthorizeRequestSchema = z.object({
  nodeId: z.string().min(1),
  token: z.string().min(1),
  tool: z.string().min(1),
})

export const GatewayNodeRoute = new Hono()
  .post(
    "/node/pair",
    describeRoute({
      summary: "Pair node client",
      description: "Pair a reference desktop/mobile node client and return a reconnect token.",
      operationId: "gateway.node.pair",
      tags: ["Gateway"],
      responses: {
        200: {
          description: "Node paired",
          content: {
            "application/json": {
              schema: resolver(NodePairResponseSchema),
            },
          },
        },
        ...errors(400, 403, 500),
      },
    }),
    validator("json", NodePairRequestSchema),
    async (c) => {
      const cfg = await Config.get()
      const policy = resolveNodeClientPolicy(cfg)
      if (!policy.enabled) {
        return c.json({ error: "Node-client pairing is disabled by policy (gateway.nodeClient.enabled=false)." }, 403)
      }

      const hostname = typeof cfg?.server?.hostname === "string" ? cfg.server.hostname : "127.0.0.1"
      if (!policy.allowRemotePairing && !isLoopbackHostname(hostname)) {
        return c.json(
          {
            error:
              "Remote node pairing is disabled on non-loopback bind. Set gateway.nodeClient.allowRemotePairing=true only when TLS + scoped auth are enforced.",
          },
          403,
        )
      }

      const input = c.req.valid("json")
      const registry = getNodeClientRegistry()
      try {
        const paired = await registry.pairNode(
          {
            label: input.label,
            platform: input.platform,
            metadata: input.metadata,
            toolAllowlist: input.toolAllowlist,
          },
          policy,
        )
        return c.json({
          node: paired.node,
          token: paired.token,
          policy: {
            securityMode: policy.securityMode,
            maxPairedNodes: policy.maxPairedNodes,
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("Node pairing denied", { message })
        return c.json({ error: message }, 400)
      }
    },
  )
  .post(
    "/node/reconnect",
    describeRoute({
      summary: "Reconnect paired node client",
      description: "Validate paired node credentials and refresh heartbeat timestamp.",
      operationId: "gateway.node.reconnect",
      tags: ["Gateway"],
      responses: {
        200: {
          description: "Node reconnected",
          content: {
            "application/json": {
              schema: resolver(NodePublicRecordSchema),
            },
          },
        },
        ...errors(400, 401),
      },
    }),
    validator("json", NodeReconnectRequestSchema),
    async (c) => {
      const input = c.req.valid("json")
      const policy = resolveNodeClientPolicy(await Config.get())
      if (!policy.enabled) {
        return c.json({ error: "Node-client pairing is disabled by policy (gateway.nodeClient.enabled=false)." }, 403)
      }
      const registry = getNodeClientRegistry()
      try {
        const node = await registry.reconnect({ nodeId: input.nodeId, token: input.token })
        return c.json(node)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ error: message }, message.includes("Invalid node token") ? 401 : 400)
      }
    },
  )
  .post(
    "/node/revoke",
    describeRoute({
      summary: "Revoke paired node",
      description: "Revoke a node so reconnect and tool execution requests are denied.",
      operationId: "gateway.node.revoke",
      tags: ["Gateway"],
      responses: {
        200: {
          description: "Node revoked",
          content: {
            "application/json": {
              schema: resolver(NodePublicRecordSchema),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", NodeRevokeRequestSchema),
    async (c) => {
      const input = c.req.valid("json")
      const node = await getNodeClientRegistry().revoke({ nodeId: input.nodeId, reason: input.reason })
      return c.json(node)
    },
  )
  .post(
    "/node/tool/authorize",
    describeRoute({
      summary: "Authorize node tool request",
      description: "Evaluate node tool execution against deny/allowlist/full policy.",
      operationId: "gateway.node.toolAuthorize",
      tags: ["Gateway"],
      responses: {
        200: {
          description: "Authorization decision",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  authorized: z.boolean(),
                  mode: z.enum(["deny", "allowlist", "full"]),
                  reason: z.string(),
                  node: NodePublicRecordSchema,
                }),
              ),
            },
          },
        },
        ...errors(400, 401),
      },
    }),
    validator("json", NodeToolAuthorizeRequestSchema),
    async (c) => {
      const input = c.req.valid("json")
      const cfg = await Config.get()
      const policy = resolveNodeClientPolicy(cfg)
      if (!policy.enabled) {
        return c.json({ error: "Node-client pairing is disabled by policy (gateway.nodeClient.enabled=false)." }, 403)
      }
      try {
        const result = await getNodeClientRegistry().authorizeTool({
          nodeId: input.nodeId,
          token: input.token,
          tool: input.tool,
          policy,
        })
        return c.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ error: message }, message.includes("Invalid node token") ? 401 : 400)
      }
    },
  )
  .get(
    "/node",
    describeRoute({
      summary: "List paired nodes",
      description: "List paired nodes and revoke status.",
      operationId: "gateway.node.list",
      tags: ["Gateway"],
      responses: {
        200: {
          description: "Paired nodes",
          content: {
            "application/json": {
              schema: resolver(z.array(NodePublicRecordSchema)),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        includeRevoked: z.coerce.boolean().optional(),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query")
      const nodes = await getNodeClientRegistry().list({ includeRevoked: query.includeRevoked })
      return c.json(nodes)
    },
  )
