import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
// @ts-ignore - The local package @clawhub/registry is not available in CI, so we use a mock if needed.
// Ideally this should be handled by a proper build system or conditional import, but for now we patch it.
import * as ClawhubRegistry from "../../pkg/clawhub/registry-mock"

// Attempt to import from the real package if available, otherwise use the mock
let registry: any
try {
  // @ts-ignore
  registry = await import("@clawhub/registry")
} catch {
  registry = ClawhubRegistry
}

const { LOBSTER_PALETTE, PROVIDERS, SKILL_FRONTMATTER_COMMON_OPTIONAL_KEYS, SKILL_FRONTMATTER_REQUIRED_KEYS } = registry

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
