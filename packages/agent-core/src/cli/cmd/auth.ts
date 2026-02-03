import { Auth } from "../../auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { Provider } from "../../provider/provider"
import { filter, map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import type { Hooks } from "@agent-core/plugin"
import { modify, applyEdits } from "jsonc-parser"
import { Skill } from "../../skill"
import { createAuthorizedFetch } from "@/server/auth"
import {
  listProvidersByService,
  hasCredentials,
  getProviderStatus,
  getProvider,
  type ServiceType,
} from "../../../../../src/config/providers"

/** Local providers that need host:port instead of API key */
const LOCAL_PROVIDERS = new Set(["vllm", "ollama", "lmstudio", "llamacpp", "tgi"])

/** Default ports for local providers */
const LOCAL_PROVIDER_DEFAULTS: Record<string, { port: number; hint: string }> = {
  vllm: { port: 8000, hint: "vLLM OpenAI-compatible server" },
  ollama: { port: 11434, hint: "Ollama API server" },
  lmstudio: { port: 1234, hint: "LM Studio server" },
  llamacpp: { port: 8080, hint: "llama.cpp server" },
  tgi: { port: 8080, hint: "Text Generation Inference" },
}

/** Providers that only need auth storage (not LLM model providers) */
const AUTH_ONLY_PROVIDERS: Record<string, { name: string; hint?: string }> = {
  kernel: { name: "Kernel", hint: "Kernel MCP API key" },
  voyage: { name: "Voyage AI", hint: "Embedding and reranking API key" },
  "minimax-tts": {
    name: "MiniMax TTS",
    hint: "MiniMax TTS API key",
  },
}

const DEFAULT_DAEMON_PORT = 3210

function normalizeDaemonHost(hostname?: string): string {
  if (!hostname || hostname === "0.0.0.0") return "127.0.0.1"
  return hostname
}

function resolveDaemonUrl(config?: Config.Info): string {
  const direct = process.env.AGENT_CORE_URL ?? process.env.OPENCODE_URL
  if (direct && direct.trim().length > 0) return direct.trim()
  const portEnv = Number(process.env.AGENT_CORE_PORT ?? "")
  const port =
    config?.server?.port ??
    (Number.isFinite(portEnv) && portEnv > 0 ? portEnv : DEFAULT_DAEMON_PORT)
  const hostname = normalizeDaemonHost(config?.server?.hostname ?? "127.0.0.1")
  return `http://${hostname}:${port}`
}

async function notifyDaemonAuthChange(config?: Config.Info) {
  let resolvedConfig = config
  if (!resolvedConfig) {
    resolvedConfig = await Config.get().catch(() => undefined)
  }
  const url = resolveDaemonUrl(resolvedConfig)
  if (!url) return
  try {
    const authorizedFetch = createAuthorizedFetch(fetch)
    await authorizedFetch(`${url}/instance/dispose`, {
      method: "POST",
      headers: {
        "x-opencode-directory": process.cwd(),
      },
    })
  } catch {
    // Daemon may be offline; ignore.
  }
}

/**
 * Add a provider to the global config file.
 */
async function addProviderToConfig(
  providerId: string,
  providerConfig: { options: { baseURL: string } },
) {
  const configPath = path.join(Global.Path.config, "agent-core.jsonc")
  const file = Bun.file(configPath)

  let text = "{}"
  if (await file.exists()) {
    text = await file.text()
  }

  // Use jsonc-parser to modify while preserving comments
  const edits = modify(text, ["provider", providerId], providerConfig, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const result = applyEdits(text, edits)

  await Bun.write(configPath, result)
  return configPath
}

/** A skill that requires credentials (env vars or primaryEnv). */
interface SkillAuthProvider {
  /** Skill name (used as key in skills.entries). */
  name: string
  /** Human-friendly label for the selection menu. */
  label: string
  /** The single primary env var, if any. */
  primaryEnv?: string
  /** All required env vars from requires.env. */
  envVars: string[]
}

/**
 * Discover installed skills that need credentials (primaryEnv or requires.env).
 * Returns entries suitable for injection into the auth login flow.
 */
async function discoverSkillAuthProviders(): Promise<SkillAuthProvider[]> {
  const skills = await Skill.all()
  const providers: SkillAuthProvider[] = []

  for (const skill of skills) {
    const envVars = skill.requires?.env ?? []
    const primaryEnv = skill.primaryEnv
    if (!primaryEnv && envVars.length === 0) continue

    const allEnvVars = primaryEnv && !envVars.includes(primaryEnv) ? [primaryEnv, ...envVars] : [...envVars]

    providers.push({
      name: skill.name,
      label: `${skill.description || skill.name} (Requires ${allEnvVars.join(", ")})`,
      primaryEnv,
      envVars: allEnvVars,
    })
  }

  return providers
}

/** Marker prefix to distinguish skill providers from LLM providers. */
const SKILL_PROVIDER_PREFIX = "skill:"

/**
 * Write skill credentials to config (skills.entries.<name>).
 * Single primaryEnv -> apiKey field. Multiple env vars -> env object.
 */
async function updateSkillConfig(
  skillName: string,
  credentials: { apiKey?: string; env?: Record<string, string> },
): Promise<void> {
  const configPath = path.join(Global.Path.config, "agent-core.jsonc")
  const file = Bun.file(configPath)

  let text = "{}"
  if (await file.exists()) {
    text = await file.text()
  }

  const opts = { formattingOptions: { tabSize: 2, insertSpaces: true } }

  if (credentials.apiKey) {
    const edits = modify(text, ["skills", "entries", skillName, "apiKey"], credentials.apiKey, opts)
    text = applyEdits(text, edits)
  }

  if (credentials.env) {
    for (const [key, value] of Object.entries(credentials.env)) {
      const edits = modify(text, ["skills", "entries", skillName, "env", key], value, opts)
      text = applyEdits(text, edits)
    }
  }

  await Bun.write(configPath, text)
}

/**
 * Remove a skill's credentials from config (skills.entries.<name>).
 */
async function removeSkillConfig(skillName: string): Promise<void> {
  const configPath = path.join(Global.Path.config, "agent-core.jsonc")
  const file = Bun.file(configPath)
  if (!(await file.exists())) return

  let text = await file.text()
  const edits = modify(text, ["skills", "entries", skillName], undefined, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  text = applyEdits(text, edits)
  await Bun.write(configPath, text)
}

type PluginAuth = NonNullable<Hooks["auth"]>

/**
 * Handle plugin-based authentication flow.
 * Returns true if auth was handled, false if it should fall through to default handling.
 */
async function handlePluginAuth(
  plugin: { auth: PluginAuth },
  provider: string,
  config?: Config.Info,
): Promise<boolean> {
  let index = 0
  if (plugin.auth.methods.length > 1) {
    const method = await prompts.select({
      message: "Login method",
      options: [
        ...plugin.auth.methods.map((x, index) => ({
          label: x.label,
          value: index.toString(),
        })),
      ],
    })
    if (prompts.isCancel(method)) throw new UI.CancelledError()
    index = parseInt(method)
  }
  const method = plugin.auth.methods[index]

  // Handle prompts for all auth types
  await Bun.sleep(10)
  const inputs: Record<string, string> = {}
  if (method.prompts) {
    for (const prompt of method.prompts) {
      if (prompt.condition && !prompt.condition(inputs)) {
        continue
      }
      if (prompt.type === "select") {
        const value = await prompts.select({
          message: prompt.message,
          options: prompt.options,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      } else {
        const value = await prompts.text({
          message: prompt.message,
          placeholder: prompt.placeholder,
          validate: prompt.validate ? (v) => prompt.validate!(v ?? "") : undefined,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      }
    }
  }

  if (method.type === "oauth") {
    const authorize = await method.authorize(inputs)

    if (authorize.url) {
      prompts.log.info("Go to: " + authorize.url)
    }

    if (authorize.method === "auto") {
      if (authorize.instructions) {
        prompts.log.info(authorize.instructions)
      }
      const spinner = prompts.spinner()
      spinner.start("Waiting for authorization...")
      const result = await authorize.callback()
      if (result.type === "failed") {
        spinner.stop("Failed to authorize", 1)
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
          await notifyDaemonAuthChange(config)
        }
        if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
          await notifyDaemonAuthChange(config)
        }
        spinner.stop("Login successful")
      }
    }

    if (authorize.method === "code") {
      const code = await prompts.text({
        message: "Paste the authorization code here: ",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(code)) throw new UI.CancelledError()
      const result = await authorize.callback(code)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
          await notifyDaemonAuthChange(config)
        }
        if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
          await notifyDaemonAuthChange(config)
        }
        prompts.log.success("Login successful")
      }
    }

    prompts.outro("Done")
    return true
  }

  if (method.type === "api") {
    if (method.authorize) {
      const result = await method.authorize(inputs)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        await Auth.set(saveProvider, {
          type: "api",
          key: result.key,
        })
        await notifyDaemonAuthChange(config)
        prompts.log.success("Login successful")
      }
      prompts.outro("Done")
      return true
    }
  }

  return false
}

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs
      .command(AuthLoginCommand)
      .command(AuthLogoutCommand)
      .command(AuthListCommand)
      .command(AuthProvidersCommand)
      .demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || AUTH_ONLY_PROVIDERS[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    prompts.outro(`${results.length} credentials`)

    // Environment variables section
    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }

    // Skills credentials section
    const config = await Config.get().catch(() => undefined)
    const skillEntries = config?.skills?.entries
    if (skillEntries) {
      const configuredSkills = Object.entries(skillEntries).filter(
        ([, entry]) => entry && (entry.apiKey || (entry.env && Object.keys(entry.env).length > 0)),
      )

      if (configuredSkills.length > 0) {
        UI.empty()
        prompts.intro("Skills")

        for (const [name, entry] of configuredSkills) {
          const fields: string[] = []
          if (entry.apiKey) fields.push("apiKey")
          if (entry.env) fields.push(...Object.keys(entry.env))
          prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${fields.join(", ")}`)
        }

        prompts.outro(`${configuredSkills.length} skill credential` + (configuredSkills.length === 1 ? "" : "s"))
      }
    }
  },
})

export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "auth provider URL",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")
        const config = await Config.get()
        const rawInput = typeof args.url === "string" ? args.url.trim() : ""
        let providerArg: string | undefined
        if (rawInput) {
          try {
            const url = new URL(rawInput)
            const wellknown = await fetch(`${url.toString().replace(/\/$/, "")}/.well-known/opencode`).then(
              (x) => x.json() as any,
            )
            prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
            const proc = Bun.spawn({
              cmd: wellknown.auth.command,
              stdout: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
              prompts.log.error("Failed")
              prompts.outro("Done")
              return
            }
            const token = await new Response(proc.stdout).text()
            await Auth.set(url.toString(), {
              type: "wellknown",
              key: wellknown.auth.env,
              token: token.trim(),
            })
            await notifyDaemonAuthChange(config)
            prompts.log.success("Logged into " + url.toString())
            prompts.outro("Done")
            return
          } catch {
            providerArg = rawInput
          }
        }
        await ModelsDev.refresh().catch(() => {})

        const disabled = new Set(config.disabled_providers ?? [])
        const isBlocked = (providerID: string) => disabled.has(providerID) || Provider.isProviderBlocked(providerID)

        const providers = await ModelsDev.get().then((x) => {
          const filtered: Record<string, (typeof x)[string]> = {}
          for (const [key, value] of Object.entries(x)) {
            if (!isBlocked(key)) {
              filtered[key] = value
            }
          }
          return filtered
        })

        // Inject plugin providers (e.g., gemini-cli from opencode-google-auth)
        const pluginDisplayNames: Record<string, string> = {
          "gemini-cli": "Gemini CLI",
          "google-antigravity": "Google Antigravity",
        }
        const pluginHooks = await Plugin.list()
        for (const hooks of pluginHooks) {
          if (hooks.auth?.provider) {
            const id = hooks.auth.provider
            if (!isBlocked(id) && !providers[id]) {
              // Add minimal provider entry for auth display
              providers[id] = {
                id,
                name: pluginDisplayNames[id] ?? id,
                env: [],
                models: {},
              } as (typeof providers)[string]
            }
          }
        }

        // Inject local providers (vllm, ollama, etc.) - always available
        const localProviderDisplayNames: Record<string, string> = {
          vllm: "vLLM (Local)",
          ollama: "Ollama (Local)",
          lmstudio: "LM Studio (Local)",
          llamacpp: "llama.cpp (Local)",
          tgi: "TGI (Local)",
        }
        for (const id of LOCAL_PROVIDERS) {
          if (!isBlocked(id) && !providers[id]) {
            providers[id] = {
              id,
              name: localProviderDisplayNames[id] ?? id,
              env: [],
              models: {},
            } as (typeof providers)[string]
          }
        }

        // Inject auth-only providers (non-LLM providers that still use auth login)
        for (const [id, providerInfo] of Object.entries(AUTH_ONLY_PROVIDERS)) {
          if (!isBlocked(id) && !providers[id]) {
            providers[id] = {
              id,
              name: providerInfo.name,
              env: [],
              models: {},
            } as (typeof providers)[string]
          }
        }

        // Inject custom providers from config
        if (config.provider) {
          for (const id of Object.keys(config.provider)) {
            if (!isBlocked(id) && !providers[id]) {
              providers[id] = {
                id,
                name: id,
                env: [],
                models: {},
              } as (typeof providers)[string]
            }
          }
        }

        // Discover skills with credential requirements
        const skillAuthProviders = await discoverSkillAuthProviders()
        const skillProviderMap = new Map<string, SkillAuthProvider>()
        for (const sp of skillAuthProviders) {
          const id = SKILL_PROVIDER_PREFIX + sp.name
          skillProviderMap.set(id, sp)
          if (!providers[id]) {
            providers[id] = {
              id,
              name: sp.label,
              env: [],
              models: {},
            } as (typeof providers)[string]
          }
        }

        const existingCredentials = await Auth.all()
        const credentialProviderIds = new Set(Object.keys(existingCredentials))

        // Also mark skills with existing config entries as "configured"
        const configEntries = config.skills?.entries ?? {}
        for (const [id, sp] of skillProviderMap) {
          if (configEntries[sp.name]?.apiKey || configEntries[sp.name]?.env) {
            credentialProviderIds.add(id)
          }
        }

        // Filter to only providers with existing credentials
        const configuredProviders = pipe(
          providers,
          values(),
          filter((x) => credentialProviderIds.has(x.id)),
          sortBy((x) => x.name ?? x.id),
        )

        let provider = providerArg ?? ""

        // If a direct skill name was passed (e.g., "home-assistant"), resolve to skill provider
        if (provider && !providers[provider]) {
          const skillId = SKILL_PROVIDER_PREFIX + provider
          if (skillProviderMap.has(skillId)) {
            provider = skillId
          }
        }

        if (!provider) {
          const ADD_NEW = "__add_new__"
          const options = [
            ...pipe(
              configuredProviders,
              map((x) => ({
                label: x.name,
                value: x.id,
                hint: existingCredentials[x.id]?.type,
              })),
            ),
            {
              label: "Add new provider...",
              value: ADD_NEW,
            },
          ]

          const selected = await prompts.select({
            message: "Select provider",
            options,
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()

          if (selected === ADD_NEW) {
            // Show all providers for adding new credential
            const priority: Record<string, number> = {
              anthropic: 0,
              "gemini-cli": 1,
              openai: 2,
              google: 3,
              "google-antigravity": 4,
              openrouter: 4,
              kernel: 5,
            }
            const newProvider = await prompts.autocomplete({
              message: "Select provider to add",
              maxItems: 8,
              options: [
                ...pipe(
                  providers,
                  values(),
                  filter((x) => !credentialProviderIds.has(x.id)),
                  sortBy(
                    (x) => priority[x.id] ?? 99,
                    (x) => x.name ?? x.id,
                  ),
                  map((x) => ({
                    label: x.name,
                    value: x.id,
                    hint: {
                      anthropic: "Recommended - Claude Max or API key",
                      "google-antigravity": "Google OAuth (Antigravity)",
                      openai: "ChatGPT Plus/Pro or API key",
                      kernel: AUTH_ONLY_PROVIDERS.kernel?.hint,
                    }[x.id],
                  })),
                ),
              ],
            })
            if (prompts.isCancel(newProvider)) throw new UI.CancelledError()
            provider = newProvider as string
          } else {
            provider = selected as string
          }
        }

        // Check if provider is known (either in LLM models database, unified provider registry, or skill)
        const knownProvider = provider in providers || getProvider(provider) !== undefined || skillProviderMap.has(provider)
        if (!knownProvider) {
          provider = provider.replace(/^@ai-sdk\//, "")
          const customPlugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider, config)
            if (handled) return
          }
          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in agent-core.json, check the docs for examples.`,
          )
        }

        const plugin = await Plugin.list().then((x) => x.findLast((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider, config)
          if (handled) return
        }

        if (["cloudflare", "cloudflare-ai-gateway"].includes(provider)) {
          prompts.log.info(
            "Cloudflare AI Gateway can be configured with CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN environment variables.",
          )
        }

        // Handle local providers (vllm, ollama, etc.) - prompt for host:port instead of API key
        if (LOCAL_PROVIDERS.has(provider)) {
          const defaults = LOCAL_PROVIDER_DEFAULTS[provider] ?? { port: 8000, hint: "Local server" }

          const host = await prompts.text({
            message: "Enter server host",
            placeholder: "192.168.1.100 or localhost",
            initialValue: "localhost",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(host)) throw new UI.CancelledError()

          const portStr = await prompts.text({
            message: "Enter server port",
            placeholder: defaults.port.toString(),
            initialValue: defaults.port.toString(),
            validate: (x) => {
              if (!x || x.length === 0) return "Required"
              const num = parseInt(x, 10)
              if (isNaN(num) || num < 1 || num > 65535) return "Invalid port (1-65535)"
              return undefined
            },
          })
          if (prompts.isCancel(portStr)) throw new UI.CancelledError()

          const port = parseInt(portStr, 10)
          const baseURL = `http://${host}:${port}/v1`

          // Add provider to config
          const configPath = await addProviderToConfig(provider, {
            options: { baseURL },
          })

          // Store a dummy credential to mark as configured
          await Auth.set(provider, {
            type: "api",
            key: "local",
          })
          await notifyDaemonAuthChange(config)

          prompts.log.success(`${provider} configured at ${baseURL}`)
          prompts.log.info(`Config updated: ${configPath}`)
          prompts.log.info(`Use models as: ${provider}/<model-name>`)
          prompts.outro("Done")
          return
        }

        // Handle skill credential prompts
        const skillProvider = skillProviderMap.get(provider)
        if (skillProvider) {
          const isSecret = (name: string) => /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i.test(name)

          if (skillProvider.primaryEnv && skillProvider.envVars.length === 1) {
            // Single env var: store as apiKey
            const value = await prompts.password({
              message: `Enter ${skillProvider.primaryEnv}`,
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (prompts.isCancel(value)) throw new UI.CancelledError()
            await updateSkillConfig(skillProvider.name, { apiKey: value })
          } else {
            // Multiple env vars: store as env object, with apiKey for primaryEnv
            const credentials: { apiKey?: string; env?: Record<string, string> } = {}
            const envMap: Record<string, string> = {}

            for (const envVar of skillProvider.envVars) {
              const promptFn = isSecret(envVar) ? prompts.password : prompts.text
              const value = await promptFn({
                message: `Enter ${envVar}`,
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(value)) throw new UI.CancelledError()

              if (envVar === skillProvider.primaryEnv) {
                credentials.apiKey = value
              } else {
                envMap[envVar] = value
              }
            }

            if (Object.keys(envMap).length > 0) {
              credentials.env = envMap
            }
            await updateSkillConfig(skillProvider.name, credentials)
          }

          prompts.log.success(`${skillProvider.name} configured`)
          prompts.outro("Done")
          return
        }

        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()
        await Auth.set(provider, {
          type: "api",
          key,
        })
        await notifyDaemonAuthChange(config)

        // Show what services are enabled for multimedia providers
        const registryProvider = getProvider(provider)
        if (registryProvider && registryProvider.services.length > 0) {
          const serviceNames = [...registryProvider.services]
          const modelRegistry = await ModelsDev.get().catch(() => undefined)
          if (modelRegistry?.[provider]) serviceNames.push("LLM models")
          prompts.log.success(`${registryProvider.name} configured for: ${serviceNames.join(", ")}`)
        }

        prompts.outro("Done")
      },
    })
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")

    // Gather skill credentials from config
    const config = await Config.get().catch(() => undefined)
    const skillEntries = config?.skills?.entries ?? {}
    const configuredSkills = Object.entries(skillEntries).filter(
      ([, entry]) => entry && (entry.apiKey || (entry.env && Object.keys(entry.env).length > 0)),
    )

    if (credentials.length === 0 && configuredSkills.length === 0) {
      prompts.log.error("No credentials found")
      return
    }

    const database = await ModelsDev.get()
    const options = [
      ...credentials.map(([key, value]) => ({
        label:
          (database[key]?.name || AUTH_ONLY_PROVIDERS[key]?.name || key) +
          UI.Style.TEXT_DIM +
          " (" +
          value.type +
          ")",
        value: key,
      })),
      ...configuredSkills.map(([name]) => ({
        label: name + UI.Style.TEXT_DIM + " (skill)",
        value: SKILL_PROVIDER_PREFIX + name,
      })),
    ]

    const providerID = await prompts.select({
      message: "Select provider",
      options,
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()

    if (typeof providerID === "string" && providerID.startsWith(SKILL_PROVIDER_PREFIX)) {
      const skillName = providerID.slice(SKILL_PROVIDER_PREFIX.length)
      await removeSkillConfig(skillName)
      prompts.outro(`Removed credentials for ${skillName}`)
    } else {
      await Auth.remove(providerID)
      await notifyDaemonAuthChange()
      prompts.outro("Logout successful")
    }
  },
})

const SERVICE_LABELS: Record<ServiceType, string> = {
  embedding: "Embedding",
  reranking: "Reranking",
  tts: "Text-to-Speech",
  stt: "Speech-to-Text",
  image: "Image Generation",
}

export const AuthProvidersCommand = cmd({
  command: "providers",
  describe: "list available providers by service type",
  async handler() {
    UI.empty()
    prompts.intro("Available Providers")

    const byService = listProvidersByService()
    const authStore = await Auth.all()

    for (const [service, providers] of Object.entries(byService)) {
      if (providers.length === 0) continue

      prompts.log.message("")
      prompts.log.info(`${UI.Style.TEXT_NORMAL_BOLD}${SERVICE_LABELS[service as ServiceType]}${UI.Style.TEXT_NORMAL}`)

      for (const provider of providers) {
        const hasAuthStoreCredential = authStore[provider.id] !== undefined
        const status = getProviderStatus(provider, hasAuthStoreCredential)
        const statusText =
          status === "configured"
            ? `${UI.Style.TEXT_SUCCESS}[configured]${UI.Style.TEXT_NORMAL}`
            : status === "local"
              ? `${UI.Style.TEXT_INFO}[local]${UI.Style.TEXT_NORMAL}`
              : `${UI.Style.TEXT_DIM}[not configured]${UI.Style.TEXT_NORMAL}`

        prompts.log.info(`  ${provider.id.padEnd(12)} ${provider.name.padEnd(20)} ${statusText}`)
      }
    }

    prompts.log.message("")
    prompts.log.info(`${UI.Style.TEXT_DIM}Use 'agent-core auth login <provider>' to configure credentials${UI.Style.TEXT_NORMAL}`)
    prompts.outro("")
  },
})
