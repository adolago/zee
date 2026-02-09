import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { z } from "zod"
import { mapValues } from "remeda"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { Config } from "../../config/config"
import { ProviderAuth } from "../../provider/auth"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { Log } from "../../util/log"
import { errors } from "../error"

const log = Log.create({ service: "server:model" })

const SERVICE_PROVIDER_NAMES: Record<string, string> = {
  "gemini-cli": "Gemini CLI",
}

const resolveDefaultModels = (providers: Record<string, Provider.Info>) => {
  const defaults: Record<string, string> = {}
  for (const [id, item] of Object.entries(providers)) {
    const models = Object.values(item.models)
    if (models.length === 0) continue
    const [best] = Provider.sort(models)
    if (best) defaults[id] = best.id
  }
  return defaults
}

export const ModelRoute = new Hono()
  .get(
    "/config/providers",
    describeRoute({
      summary: "List config providers",
      description: "Get a list of all configured AI providers and their default models.",
      operationId: "config.providers",
      responses: {
        200: {
          description: "List of providers",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  providers: Provider.Info.array(),
                  default: z.record(z.string(), z.string()),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      using _ = log.time("providers")
      const providers = await Provider.list().then((x) => mapValues(x, (item) => item))
      return c.json({
        providers: Object.values(providers),
        default: resolveDefaultModels(providers),
      })
    },
  )
  .get(
    "/provider",
    describeRoute({
      summary: "List providers",
      description: "Get a list of all available AI providers, including both available and connected ones.",
      operationId: "provider.list",
      responses: {
        200: {
          description: "List of providers",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  all: ModelsDev.Provider.array(),
                  default: z.record(z.string(), z.string()),
                  connected: z.array(z.string()),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const config = await Config.get()
      const disabled = new Set(config.disabled_providers ?? [])
      const isBlocked = (providerID: string) => disabled.has(providerID) || Provider.isProviderBlocked(providerID)

      const allProviders = await ModelsDev.get()
      const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
      for (const [key, value] of Object.entries(allProviders)) {
        if (!isBlocked(key)) {
          filteredProviders[key] = value
        }
      }

      const serviceProviders = await ProviderAuth.methods()
      for (const providerID of Object.keys(serviceProviders)) {
        if (!filteredProviders[providerID] && !isBlocked(providerID)) {
          filteredProviders[providerID] = {
            id: providerID,
            name: SERVICE_PROVIDER_NAMES[providerID] ?? providerID.charAt(0).toUpperCase() + providerID.slice(1),
            env: [],
            models: {},
          }
        }
      }

      const connected = await Provider.list()
      const connectedServiceProviders = Object.keys(serviceProviders).filter(
        (id) => !filteredProviders[id]?.models || Object.keys(filteredProviders[id].models).length === 0,
      )
      for (const id of connectedServiceProviders) {
        const auth = await Auth.get(id)
        if (auth) {
          connected[id] = {
            id,
            name: SERVICE_PROVIDER_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1),
            source: "api",
            env: [],
            options: {},
            models: {},
          }
        }
      }

      const providers = Object.assign(
        mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
        connected,
      )
      const auth = await Auth.all()
      const env = Env.all()
      const configProviders = config.provider ?? {}
      const connectedIds = Object.values(providers)
        .filter((provider) => {
          if (auth[provider.id]) return true
          const envKeys = provider.env ?? []
          if (envKeys.some((key) => env[key])) return true
          const cfg = (configProviders as Record<string, { options?: Record<string, unknown>; api?: string }>)[
            provider.id
          ]
          const cfgApiKey = cfg?.options?.apiKey
          if (typeof cfgApiKey === "string" && cfgApiKey.trim()) return true
          const baseURL = cfg?.options?.baseURL ?? cfg?.api ?? provider.options?.baseURL
          if (envKeys.length === 0 && typeof baseURL === "string" && baseURL.trim()) return true
          return false
        })
        .map((provider) => provider.id)
      return c.json({
        all: Object.values(providers),
        default: resolveDefaultModels(providers),
        connected: connectedIds,
      })
    },
  )
  .get(
    "/provider/auth",
    describeRoute({
      summary: "Get provider auth methods",
      description: "Retrieve available authentication methods for all AI providers.",
      operationId: "provider.auth",
      responses: {
        200: {
          description: "Provider auth methods",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await ProviderAuth.methods())
    },
  )
  .get(
    "/provider/auth/status",
    describeRoute({
      summary: "Get provider auth status",
      description: "Retrieve the current authentication status for all providers with OAuth tokens.",
      operationId: "provider.auth.status",
      responses: {
        200: {
          description: "Provider auth status",
          content: {
            "application/json": {
              schema: resolver(
                z.record(
                  z.string(),
                  z.object({
                    valid: z.boolean().meta({ description: "Whether the token is currently valid" }),
                    expiringSoon: z
                      .boolean()
                      .meta({ description: "Whether the token will expire within the refresh buffer" }),
                    expiresIn: z
                      .number()
                      .nullable()
                      .meta({ description: "Seconds until token expiry (null for non-OAuth)" }),
                  }),
                ),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await Auth.status())
    },
  )
  .post(
    "/provider/:providerID/oauth/authorize",
    describeRoute({
      summary: "OAuth authorize",
      description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
      operationId: "provider.oauth.authorize",
      responses: {
        200: {
          description: "Authorization URL and method",
          content: {
            "application/json": {
              schema: resolver(ProviderAuth.Authorization.optional()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "param",
      z.object({
        providerID: z.string().meta({ description: "Provider ID" }),
      }),
    ),
    validator(
      "json",
      z.object({
        method: z.number().meta({ description: "Auth method index" }),
      }),
    ),
    async (c) => {
      const providerID = c.req.valid("param").providerID
      const { method } = c.req.valid("json")
      const result = await ProviderAuth.authorize({
        providerID,
        method,
      })
      return c.json(result)
    },
  )
  .post(
    "/provider/:providerID/oauth/callback",
    describeRoute({
      summary: "OAuth callback",
      description: "Handle the OAuth callback from a provider after user authorization.",
      operationId: "provider.oauth.callback",
      responses: {
        200: {
          description: "OAuth callback processed successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "param",
      z.object({
        providerID: z.string().meta({ description: "Provider ID" }),
      }),
    ),
    validator(
      "json",
      z.object({
        method: z.number().meta({ description: "Auth method index" }),
        code: z.string().optional().meta({ description: "OAuth authorization code" }),
        requestId: z.string().optional().meta({ description: "OAuth request identifier" }),
      }),
    ),
    async (c) => {
      const providerID = c.req.valid("param").providerID
      const { method, code, requestId } = c.req.valid("json")
      await ProviderAuth.callback({
        providerID,
        method,
        code,
        requestId,
      })
      return c.json(true)
    },
  )
