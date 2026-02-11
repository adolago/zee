import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { z } from "zod"
import { MCP } from "../../mcp"
import { Config } from "../../config/config"
import { errors } from "../error"

export const McpRoute = new Hono()
  .get(
    "/",
    describeRoute({
      summary: "Get MCP status",
      description: "Get the status of all Model Context Protocol (MCP) servers.",
      operationId: "mcp.status",
      responses: {
        200: {
          description: "MCP server status",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), MCP.Status)),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await MCP.status())
    },
  )
  .post(
    "/:name/tool",
    describeRoute({
      summary: "Call MCP tool",
      description: "Execute a tool on a connected MCP server.",
      operationId: "mcp.tool.call",
      responses: {
        200: {
          description: "MCP tool execution result",
          content: {
            "application/json": {
              schema: resolver(z.any()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ name: z.string() })),
    validator(
      "json",
      z.object({
        tool: z.string(),
        arguments: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
    async (c) => {
      const { name } = c.req.valid("param")
      const { tool, arguments: args } = c.req.valid("json")
      const result = await MCP.callTool(name, tool, args ?? {})
      return c.json(result)
    },
  )
  .post(
    "/",
    describeRoute({
      summary: "Add MCP server",
      description: "Dynamically add a new Model Context Protocol (MCP) server to the system.",
      operationId: "mcp.add",
      responses: {
        200: {
          description: "MCP server added successfully",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), MCP.Status)),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.object({
        name: z.string(),
        config: Config.Mcp,
      }),
    ),
    async (c) => {
      const { name, config } = c.req.valid("json")
      const result = await MCP.add(name, config)
      return c.json(result.status)
    },
  )
  .post(
    "/:name/auth",
    describeRoute({
      summary: "Start MCP OAuth",
      description: "Start OAuth authentication flow for a Model Context Protocol (MCP) server.",
      operationId: "mcp.auth.start",
      responses: {
        200: {
          description: "OAuth flow started",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  authorizationUrl: z.string().describe("URL to open in browser for authorization"),
                }),
              ),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ name: z.string() })),
    async (c) => {
      const { name } = c.req.valid("param")
      const supportsOAuth = await MCP.supportsOAuth(name)
      if (!supportsOAuth) {
        return c.json(
          { data: null, errors: [{ message: `MCP server ${name} does not support OAuth` }], success: false },
          400,
        )
      }
      const result = await MCP.startAuth(name)
      return c.json(result)
    },
  )
  .post(
    "/:name/auth/callback",
    describeRoute({
      summary: "Complete MCP OAuth",
      description:
        "Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.",
      operationId: "mcp.auth.callback",
      responses: {
        200: {
          description: "OAuth authentication completed",
          content: {
            "application/json": {
              schema: resolver(MCP.Status),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ name: z.string() })),
    validator(
      "json",
      z.object({
        code: z.string().describe("Authorization code from OAuth callback"),
      }),
    ),
    async (c) => {
      const { name } = c.req.valid("param")
      const { code } = c.req.valid("json")
      const status = await MCP.finishAuth(name, code)
      return c.json(status)
    },
  )
  .post(
    "/:name/auth/authenticate",
    describeRoute({
      summary: "Authenticate MCP OAuth",
      description: "Start OAuth flow and wait for callback (opens browser)",
      operationId: "mcp.auth.authenticate",
      responses: {
        200: {
          description: "OAuth authentication completed",
          content: {
            "application/json": {
              schema: resolver(MCP.Status),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ name: z.string() })),
    async (c) => {
      const { name } = c.req.valid("param")
      const supportsOAuth = await MCP.supportsOAuth(name)
      if (!supportsOAuth) {
        return c.json(
          { data: null, errors: [{ message: `MCP server ${name} does not support OAuth` }], success: false },
          400,
        )
      }
      const status = await MCP.authenticate(name)
      return c.json(status)
    },
  )
  .delete(
    "/:name/auth",
    describeRoute({
      summary: "Remove MCP OAuth",
      description: "Remove OAuth credentials for an MCP server",
      operationId: "mcp.auth.remove",
      responses: {
        200: {
          description: "OAuth credentials removed",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.literal(true) })),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ name: z.string() })),
    async (c) => {
      const { name } = c.req.valid("param")
      await MCP.removeAuth(name)
      return c.json({ success: true as const })
    },
  )
  .post(
    "/:name/connect",
    describeRoute({
      description: "Connect an MCP server",
      operationId: "mcp.connect",
      responses: {
        200: {
          description: "MCP server connected successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("param", z.object({ name: z.string() })),
    async (c) => {
      const { name } = c.req.valid("param")
      await MCP.connect(name)
      return c.json(true)
    },
  )
  .post(
    "/:name/disconnect",
    describeRoute({
      description: "Disconnect an MCP server",
      operationId: "mcp.disconnect",
      responses: {
        200: {
          description: "MCP server disconnected successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("param", z.object({ name: z.string() })),
    async (c) => {
      const { name } = c.req.valid("param")
      await MCP.disconnect(name)
      return c.json(true)
    },
  )
  .post(
    "/:name/reconnect",
    describeRoute({
      summary: "Reconnect an MCP server",
      description: "Attempt to reconnect to an MCP server that has failed or disconnected.",
      operationId: "mcp.reconnect",
      responses: {
        200: {
          description: "MCP reconnection result",
          content: {
            "application/json": {
              schema: resolver(MCP.Status),
            },
          },
        },
      },
    }),
    validator("param", z.object({ name: z.string() })),
    async (c) => {
      const { name } = c.req.valid("param")
      const status = await MCP.reconnect(name)
      return c.json(status)
    },
  )
  .post(
    "/reconnect-all",
    describeRoute({
      summary: "Reconnect all failed MCP servers",
      description: "Attempt to reconnect to all MCP servers that are in a failed state.",
      operationId: "mcp.reconnectAll",
      responses: {
        200: {
          description: "MCP reconnection results",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), MCP.Status)),
            },
          },
        },
      },
    }),
    async (c) => {
      const results = await MCP.reconnectAll()
      return c.json(results)
    },
  )
  .post(
    "/health-check",
    describeRoute({
      summary: "Health check and reconnect MCP servers",
      description: "Check health of all connected MCPs and attempt to reconnect any that have failed.",
      operationId: "mcp.healthCheckAndReconnect",
      responses: {
        200: {
          description: "MCP health check results",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), MCP.Status)),
            },
          },
        },
      },
    }),
    async (c) => {
      const results = await MCP.healthCheckAndReconnect()
      return c.json(results)
    },
  )
  .get(
    "/experimental/resource",
    describeRoute({
      summary: "Get MCP resources",
      description: "Get all available MCP resources from connected servers. Optionally filter by name.",
      operationId: "experimental.resource.list",
      responses: {
        200: {
          description: "MCP resources",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), MCP.Resource)),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await MCP.resources())
    },
  )
