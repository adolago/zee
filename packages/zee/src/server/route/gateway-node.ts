import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { FluxRecorder } from "@/flux"
import { Config } from "../../config/config"
import { errors } from "../error"
import { isLoopbackHostname } from "../auth"
import { Log } from "../../util/log"
import { RequestMeta } from "../request-meta"
import { getNodeClientRegistry, resolveNodeClientPolicy } from "@/gateway/node-client-registry"

const log = Log.create({ service: "server:gateway-node" })

const NodePlatformSchema = z.enum(["macos", "ios", "android", "linux", "windows", "unknown"])

const NodePublicRecordSchema = z.object({
  id: z.string(),
  label: z.string(),
  platform: NodePlatformSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  tokenIssuedAt: z.number(),
  tokenVersion: z.number(),
  tokenRotatedAt: z.number().optional(),
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
    credentialMaxAgeHours: z.number(),
  }),
})

const NodeReconnectRequestSchema = z.object({
  nodeId: z.string().min(1),
  token: z.string().min(1),
})

const NodeRotateRequestSchema = z.object({
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

const NodeRotateResponseSchema = z.object({
  node: NodePublicRecordSchema,
  token: z.string(),
  policy: z.object({
    securityMode: z.enum(["deny", "allowlist", "full"]),
    maxPairedNodes: z.number(),
    credentialMaxAgeHours: z.number(),
  }),
})

type NodeLifecycleAction = "pair" | "reconnect" | "rotate" | "revoke"
type NodeAuthorizationMatch = "policy" | "global" | "node" | "global+node" | "none"

function isUnauthorizedNodeLifecycleError(message: string): boolean {
  return message.includes("Invalid node token") || message.includes("Node token expired")
}

function recordNodeLifecycle(
  c: Context,
  input: {
    action: NodeLifecycleAction
    status: "ok" | "error" | "denied"
    nodeId?: string
    reason?: string
    tokenVersion?: number
    policy?: ReturnType<typeof resolveNodeClientPolicy>
  },
) {
  const traceID = RequestMeta.getTraceID(c.req.raw) ?? crypto.randomUUID()
  const requestID = RequestMeta.getRequestID(c.req.raw)
  FluxRecorder.record({
    traceID,
    requestID,
    direction: "internal",
    domain: "gateway",
    kind: "gateway.node.lifecycle",
    status: input.status,
    method: c.req.method,
    path: c.req.path,
    route: c.req.path,
    metadata: {
      action: input.action,
      nodeId: input.nodeId,
      reason: input.reason,
      tokenVersion: input.tokenVersion,
      securityMode: input.policy?.securityMode,
      maxPairedNodes: input.policy?.maxPairedNodes,
      credentialMaxAgeHours: input.policy?.credentialMaxAgeHours,
    },
  })
}

function resolveNodeAuthorizationMatch(
  tool: string,
  nodeAllowlist: string[],
  policy: ReturnType<typeof resolveNodeClientPolicy>,
): NodeAuthorizationMatch {
  if (policy.securityMode !== "allowlist") return "policy"
  const globalMatch = policy.toolAllowlist.includes(tool)
  const nodeMatch = nodeAllowlist.includes(tool)
  if (globalMatch && nodeMatch) return "global+node"
  if (globalMatch) return "global"
  if (nodeMatch) return "node"
  return "none"
}

function recordNodeAuthorization(
  c: Context,
  input: {
    status: "ok" | "error" | "denied"
    nodeId?: string
    tool: string
    authorized?: boolean
    reason: string
    mode?: "deny" | "allowlist" | "full"
    tokenVersion?: number
    matchedBy?: NodeAuthorizationMatch
    policy?: ReturnType<typeof resolveNodeClientPolicy>
  },
) {
  const traceID = RequestMeta.getTraceID(c.req.raw) ?? crypto.randomUUID()
  const requestID = RequestMeta.getRequestID(c.req.raw)
  FluxRecorder.record({
    traceID,
    requestID,
    direction: "internal",
    domain: "gateway",
    kind: "gateway.node.authorization",
    status: input.status,
    method: c.req.method,
    path: c.req.path,
    route: c.req.path,
    metadata: {
      nodeId: input.nodeId,
      tool: input.tool,
      authorized: input.authorized,
      reason: input.reason,
      mode: input.mode,
      tokenVersion: input.tokenVersion,
      matchedBy: input.matchedBy,
      securityMode: input.policy?.securityMode,
      maxPairedNodes: input.policy?.maxPairedNodes,
      credentialMaxAgeHours: input.policy?.credentialMaxAgeHours,
    },
  })
}

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
        recordNodeLifecycle(c, {
          action: "pair",
          status: "denied",
          reason: "node-client pairing disabled by policy",
          policy,
        })
        return c.json({ error: "Node-client pairing is disabled by policy (gateway.nodeClient.enabled=false)." }, 403)
      }

      const hostname = typeof cfg?.server?.hostname === "string" ? cfg.server.hostname : "127.0.0.1"
      if (!policy.allowRemotePairing && !isLoopbackHostname(hostname)) {
        recordNodeLifecycle(c, {
          action: "pair",
          status: "denied",
          reason: "remote pairing disabled on non-loopback bind",
          policy,
        })
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
        recordNodeLifecycle(c, {
          action: "pair",
          status: "ok",
          nodeId: paired.node.id,
          tokenVersion: paired.node.tokenVersion,
          policy,
        })
        return c.json({
          node: paired.node,
          token: paired.token,
          policy: {
            securityMode: policy.securityMode,
            maxPairedNodes: policy.maxPairedNodes,
            credentialMaxAgeHours: policy.credentialMaxAgeHours,
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("Node pairing denied", { message })
        recordNodeLifecycle(c, {
          action: "pair",
          status: "error",
          reason: message,
          policy,
        })
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
        recordNodeLifecycle(c, {
          action: "reconnect",
          status: "denied",
          nodeId: input.nodeId,
          reason: "node-client pairing disabled by policy",
          policy,
        })
        return c.json({ error: "Node-client pairing is disabled by policy (gateway.nodeClient.enabled=false)." }, 403)
      }
      const registry = getNodeClientRegistry()
      try {
        const node = await registry.reconnect({ nodeId: input.nodeId, token: input.token, policy })
        recordNodeLifecycle(c, {
          action: "reconnect",
          status: "ok",
          nodeId: node.id,
          tokenVersion: node.tokenVersion,
          policy,
        })
        return c.json(node)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordNodeLifecycle(c, {
          action: "reconnect",
          status: isUnauthorizedNodeLifecycleError(message) ? "denied" : "error",
          nodeId: input.nodeId,
          reason: message,
          policy,
        })
        return c.json({ error: message }, isUnauthorizedNodeLifecycleError(message) ? 401 : 400)
      }
    },
  )
  .post(
    "/node/rotate",
    describeRoute({
      summary: "Rotate paired node credential",
      description: "Validate the current node credential and issue a replacement reconnect token.",
      operationId: "gateway.node.rotate",
      tags: ["Gateway"],
      responses: {
        200: {
          description: "Node credential rotated",
          content: {
            "application/json": {
              schema: resolver(NodeRotateResponseSchema),
            },
          },
        },
        ...errors(400, 401, 403),
      },
    }),
    validator("json", NodeRotateRequestSchema),
    async (c) => {
      const input = c.req.valid("json")
      const policy = resolveNodeClientPolicy(await Config.get())
      if (!policy.enabled) {
        recordNodeLifecycle(c, {
          action: "rotate",
          status: "denied",
          nodeId: input.nodeId,
          reason: "node-client pairing disabled by policy",
          policy,
        })
        return c.json({ error: "Node-client pairing is disabled by policy (gateway.nodeClient.enabled=false)." }, 403)
      }
      try {
        const rotated = await getNodeClientRegistry().rotateToken({
          nodeId: input.nodeId,
          token: input.token,
          policy,
        })
        recordNodeLifecycle(c, {
          action: "rotate",
          status: "ok",
          nodeId: rotated.node.id,
          tokenVersion: rotated.node.tokenVersion,
          policy,
        })
        return c.json({
          node: rotated.node,
          token: rotated.token,
          policy: {
            securityMode: policy.securityMode,
            maxPairedNodes: policy.maxPairedNodes,
            credentialMaxAgeHours: policy.credentialMaxAgeHours,
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordNodeLifecycle(c, {
          action: "rotate",
          status: isUnauthorizedNodeLifecycleError(message) ? "denied" : "error",
          nodeId: input.nodeId,
          reason: message,
          policy,
        })
        return c.json({ error: message }, isUnauthorizedNodeLifecycleError(message) ? 401 : 400)
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
      const policy = resolveNodeClientPolicy(await Config.get())
      try {
        const node = await getNodeClientRegistry().revoke({ nodeId: input.nodeId, reason: input.reason })
        recordNodeLifecycle(c, {
          action: "revoke",
          status: "ok",
          nodeId: node.id,
          tokenVersion: node.tokenVersion,
          reason: node.revokeReason,
          policy,
        })
        return c.json(node)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordNodeLifecycle(c, {
          action: "revoke",
          status: "error",
          nodeId: input.nodeId,
          reason: message,
          policy,
        })
        return c.json({ error: message }, 400)
      }
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
        ...errors(400, 401, 403),
      },
    }),
    validator("json", NodeToolAuthorizeRequestSchema),
    async (c) => {
      const input = c.req.valid("json")
      const cfg = await Config.get()
      const policy = resolveNodeClientPolicy(cfg)
      if (!policy.enabled) {
        recordNodeAuthorization(c, {
          status: "denied",
          nodeId: input.nodeId,
          tool: input.tool,
          authorized: false,
          reason: "node-client pairing disabled by policy",
          mode: policy.securityMode,
          matchedBy: "none",
          policy,
        })
        return c.json({ error: "Node-client pairing is disabled by policy (gateway.nodeClient.enabled=false)." }, 403)
      }
      try {
        const result = await getNodeClientRegistry().authorizeTool({
          nodeId: input.nodeId,
          token: input.token,
          tool: input.tool,
          policy,
        })
        recordNodeAuthorization(c, {
          status: result.authorized ? "ok" : "denied",
          nodeId: result.node.id,
          tool: input.tool,
          authorized: result.authorized,
          reason: result.reason,
          mode: result.mode,
          tokenVersion: result.node.tokenVersion,
          matchedBy: resolveNodeAuthorizationMatch(input.tool, result.node.toolAllowlist, policy),
          policy,
        })
        return c.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordNodeAuthorization(c, {
          status: isUnauthorizedNodeLifecycleError(message) ? "denied" : "error",
          nodeId: input.nodeId,
          tool: input.tool,
          authorized: false,
          reason: message,
          mode: policy.securityMode,
          matchedBy: "none",
          policy,
        })
        return c.json({ error: message }, isUnauthorizedNodeLifecycleError(message) ? 401 : 400)
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
