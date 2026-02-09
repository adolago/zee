import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { z } from "zod"
import { Config } from "../../config/config"
import { errors } from "../error"

export const ConfigRoute = new Hono()
  .get(
    "/config",
    describeRoute({
      summary: "Get configuration",
      description: "Retrieve the current agent-core configuration settings and preferences.",
      operationId: "config.get",
      responses: {
        200: {
          description: "Get config info",
          content: {
            "application/json": {
              schema: resolver(Config.Info),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(Config.redact(await Config.get()))
    },
  )
  .patch(
    "/config",
    describeRoute({
      summary: "Update configuration",
      description: "Update agent-core configuration settings and preferences.",
      operationId: "config.update",
      responses: {
        200: {
          description: "Successfully updated config",
          content: {
            "application/json": {
              schema: resolver(Config.Info),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", Config.Info),
    async (c) => {
      const config = c.req.valid("json")
      await Config.update(Config.clean(config))
      return c.json(Config.redact(await Config.get()))
    },
  )
  .get(
    "/themes",
    describeRoute({
      summary: "List available themes",
      tags: ["Config"],
      description: "Get a list of all available themes for the interface.",
      operationId: "themes.list",
      responses: {
        200: {
          description: "List of themes",
          content: {
            "application/json": {
              schema: resolver(
                z.array(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    builtin: z.boolean(),
                    persona: z.string().optional(),
                  }),
                ),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      // Built-in themes from theme.tsx
      const builtinThemes = [
        "aura",
        "ayu",
        "catppuccin",
        "catppuccin-frappe",
        "catppuccin-macchiato",
        "cobalt2",
        "cursor",
        "dracula",
        "everforest",
        "flexoki",
        "github",
        "gruvbox",
        "kanagawa",
        "material",
        "matrix",
        "mercury",
        "monokai",
        "nightowl",
        "nord",
        "one-dark",
        "opencode",
        "orng",
        "lucent-orng",
        "osaka-jade",
        "palenight",
        "rosepine",
        "solarized",
        "synthwave84",
        "tokyonight",
        "vercel",
        "vesper",
        "zenburn",
      ]

      // Persona-specific themes
      const personaThemes = [
        { id: "zee", name: "Zee", builtin: true, persona: "zee" },
        { id: "stanley", name: "Stanley", builtin: true, persona: "stanley" },
        { id: "johny", name: "Johny", builtin: true, persona: "johny" },
      ]

      const themes = [
        ...builtinThemes.map((id) => ({
          id,
          name: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " "),
          builtin: true,
        })),
        ...personaThemes,
      ]

      return c.json(themes)
    },
  )
  .get(
    "/preferences/theme",
    describeRoute({
      summary: "Get current theme",
      tags: ["Config"],
      description: "Get the current theme setting.",
      operationId: "preferences.theme.get",
      responses: {
        200: {
          description: "Current theme",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  theme: z.string(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const config = await Config.get()
      return c.json({ theme: config.theme ?? "opencode" })
    },
  )
  .patch(
    "/preferences/theme",
    describeRoute({
      summary: "Set theme",
      tags: ["Config"],
      description: "Update the current theme setting.",
      operationId: "preferences.theme.set",
      responses: {
        200: {
          description: "Theme updated",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  theme: z.string(),
                }),
              ),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.object({
        theme: z.string().min(1).describe("Theme ID to set"),
      }),
    ),
    async (c) => {
      const { theme } = c.req.valid("json")
      const config = await Config.get()
      await Config.update({ ...config, theme })
      return c.json({ theme })
    },
  )
