import { describeRoute, resolver } from "hono-openapi"
import { Hono } from "hono"
import { LSP } from "../../lsp"
import { Format } from "../../format"

export const LspRoute = new Hono()
  .get(
    "/lsp",
    describeRoute({
      summary: "Get LSP status",
      description: "Get LSP server status",
      operationId: "lsp.status",
      responses: {
        200: {
          description: "LSP server status",
          content: {
            "application/json": {
              schema: resolver(LSP.Status.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await LSP.status())
    },
  )
  .get(
    "/formatter",
    describeRoute({
      summary: "Get formatter status",
      description: "Get formatter status",
      operationId: "formatter.status",
      responses: {
        200: {
          description: "Formatter status",
          content: {
            "application/json": {
              schema: resolver(Format.Status.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await Format.status())
    },
  )
