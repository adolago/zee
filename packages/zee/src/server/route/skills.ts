import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { Skill } from "../../skill/skill"
import { getSkillsVersion } from "../../skill/watcher"

const SkillsIndexQuery = z.object({
  agent: z.string().optional().meta({ description: "Optional agent/persona id to sort by affinity" }),
})

export const SkillsRoute = new Hono().get(
  "/v1/skills/index",
  describeRoute({
    summary: "Skills index",
    description: "Return the current skill snapshot index (name + description + metadata).",
    operationId: "skills.index",
    responses: {
      200: {
        description: "Skills index",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                version: z.number(),
                skills: z.array(z.any()),
              }),
            ),
          },
        },
      },
    },
  }),
  validator("query", SkillsIndexQuery),
  async (c) => {
    const { agent } = c.req.valid("query")
    const skills = await Skill.all(agent)
    return c.json({
      version: getSkillsVersion(),
      skills,
    })
  },
)
