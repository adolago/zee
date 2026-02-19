import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"
import { Skill } from "../../skill/skill"
import { getSkillsVersion } from "../../skill/watcher"
import { Agent } from "../../agent/agent"

const SkillsIndexQuery = z.object({
  agent: z.string().optional().meta({ description: "Optional agent/persona id to sort by affinity" }),
})

const SkillReadinessSchema = z.object({
  permission: z.enum(["allow", "ask", "deny"]),
  env: z.enum(["ready", "partial", "missing", "not-required"]),
  missingEnv: z.array(z.string()),
})

const SkillRecommendBody = z.object({
  query: z.string().min(1),
  agent: z.string().optional(),
  max: z.number().int().min(1).max(20).optional(),
})

export const SkillsRoute = new Hono()
  .get(
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
                  skills: z.array(
                    z.object({
                      name: z.string(),
                      description: z.string(),
                      location: z.string(),
                      context: z.enum(["zee", "stanley", "johny"]).optional(),
                      affinity: z.enum(["own", "shared", "cross"]),
                      readiness: SkillReadinessSchema,
                    }),
                  ),
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
      const agentInfo = agent ? await Agent.get(agent) : undefined
      const skills = await Skill.index(agent, agentInfo?.permission)
      return c.json({
        version: getSkillsVersion(),
        skills,
      })
    },
  )
  .post(
    "/v1/skills/recommend",
    describeRoute({
      summary: "Recommend skills",
      description: "Rank and return the most relevant skills for a user query.",
      operationId: "skills.recommend",
      responses: {
        200: {
          description: "Recommended skills",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  version: z.number(),
                  recommendations: z.array(
                    z.object({
                      name: z.string(),
                      description: z.string(),
                      location: z.string(),
                      affinity: z.enum(["own", "shared", "cross"]),
                      context: z.enum(["zee", "stanley", "johny"]).optional(),
                      score: z.number(),
                      reason: z.string(),
                      readiness: SkillReadinessSchema,
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    validator("json", SkillRecommendBody),
    async (c) => {
      const { query, agent, max } = c.req.valid("json")
      const agentInfo = agent ? await Agent.get(agent) : undefined
      const recommendations = await Skill.recommend(query, agent, {
        limit: max,
        permission: agentInfo?.permission,
      })
      return c.json({
        version: getSkillsVersion(),
        recommendations,
      })
    },
  )
