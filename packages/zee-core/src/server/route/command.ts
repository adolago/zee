import { describeRoute, resolver } from "hono-openapi"
import { Hono } from "hono"
import { z } from "zod"
import { Command } from "../../command"

export const CommandRoute = new Hono().get(
  "/",
  describeRoute({
    summary: "List commands",
    description: "Get a list of all available commands in the agent-core system.",
    operationId: "command.list",
    responses: {
      200: {
        description: "List of commands",
        content: {
          "application/json": {
            schema: resolver(
              z.array(
                z.object({
                  id: z.string(),
                  description: z.string(),
                  usage: z.string(),
                  examples: z.array(z.string()),
                }),
              ),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const commands = await Command.list()
    const result = commands.map((cmd) => {
      const hints = cmd.hints ?? []
      const usage = `/${cmd.name}${hints.length ? " " + hints.join(" ") : ""}`
      const examples = hints.length ? hints.map((hint) => `/${cmd.name} ${hint}`) : []
      return {
        id: cmd.name,
        description: cmd.description ?? "",
        usage,
        examples,
      }
    })
    return c.json(result)
  },
)
