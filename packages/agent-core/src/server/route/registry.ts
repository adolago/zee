import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { LOBSTER_PALETTE, PROVIDERS, SKILL_FRONTMATTER_COMMON_OPTIONAL_KEYS, SKILL_FRONTMATTER_REQUIRED_KEYS } from "./registry-stub"

const PaletteSchema = z.record(z.string(), z.string())
const ProviderSchema = z.record(
  z.string(),
  z.object({
    label: z.string(),
    icon: z.string().optional(),
  }),
)

export const RegistryRoute = new Hono()
  .get(
    "/v1/registry/palette",
    describeRoute({
      summary: "Registry: palette",
      description: "Get canonical palette tokens shared across stacks.",
      operationId: "registry.palette",
      responses: {
        200: {
          description: "Palette",
          content: {
            "application/json": {
              schema: resolver(z.object({ palette: PaletteSchema })),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({ palette: LOBSTER_PALETTE })
    },
  )
  .get(
    "/v1/registry/providers",
    describeRoute({
      summary: "Registry: providers",
      description: "Get canonical provider IDs and display metadata.",
      operationId: "registry.providers",
      responses: {
        200: {
          description: "Providers",
          content: {
            "application/json": {
              schema: resolver(z.object({ providers: ProviderSchema })),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({ providers: PROVIDERS })
    },
  )
  .get(
    "/v1/registry/skills/frontmatter",
    describeRoute({
      summary: "Registry: skill frontmatter keys",
      description: "Get the shared skill frontmatter contract (required/common optional keys).",
      operationId: "registry.skills.frontmatter",
      responses: {
        200: {
          description: "Skill frontmatter keys",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  required: z.array(z.string()),
                  optional: z.array(z.string()),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({
        required: SKILL_FRONTMATTER_REQUIRED_KEYS,
        optional: SKILL_FRONTMATTER_COMMON_OPTIONAL_KEYS,
      })
    },
  )
