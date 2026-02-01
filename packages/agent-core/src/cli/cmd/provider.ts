import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { Config } from "../../config/config"
import { Auth } from "../../auth"
import { CircuitBreaker } from "../../provider/circuit-breaker"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"

const ProviderDiagnoseCommand = cmd({
  command: "diagnose <model>",
  describe: "diagnose filtering for a specific model (provider/model format)",
  builder: (yargs: Argv) => {
    return yargs.positional("model", {
      describe: "model in provider/model format (e.g. anthropic/claude-opus-4-5)",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const input = args.model as string
        const slash = input.indexOf("/")
        if (slash === -1) {
          UI.error("Model must be in provider/model format (e.g. anthropic/claude-opus-4-5)")
          return
        }
        const providerID = input.slice(0, slash)
        const modelID = input.slice(slash + 1)

        process.stdout.write(`${EOL}${UI.Style.TEXT_HIGHLIGHT}${providerID}/${modelID}${UI.Style.TEXT_NORMAL}${EOL}`)

        const config = await Config.get()
        const modelsDev = await ModelsDev.get()

        // 1. Check if provider exists in models.dev
        const providerEntry = modelsDev[providerID]
        if (providerEntry) {
          pass("Provider in models.dev database")
        } else {
          fail("Provider not in models.dev database")
        }

        // 2. Check provider blacklist
        const providerBlReason = Provider.getProviderBlacklistReason(providerID)
        if (providerBlReason) {
          fail(`Provider blacklisted: ${providerBlReason}`)
        } else {
          pass("Provider not blacklisted")
        }

        // 3. Check disabled_providers config
        const disabled = new Set(config.disabled_providers ?? [])
        if (disabled.has(providerID)) {
          fail("Provider in disabled_providers config")
        } else {
          pass("Provider not in disabled_providers")
        }

        // 4. Check if model exists in models.dev
        if (providerEntry) {
          const modelEntry = providerEntry.models[modelID]
          if (modelEntry) {
            pass("Model in models.dev database")
            if (modelEntry.status === "deprecated") {
              fail("Model status: deprecated")
            } else {
              pass(`Model status: ${modelEntry.status ?? "active"}`)
            }
          } else {
            warn("Model not in models.dev database (may be config-only)")
          }
        }

        // 5. Check hard-coded model blacklist
        const modelBlReason = Provider.getModelBlacklistReason(providerID, modelID)
        if (modelBlReason) {
          fail(`Model blacklisted: ${modelBlReason}`)
        } else {
          pass("Model not in hard-coded blacklist")
        }

        // 6. Check config blacklist/whitelist
        const configProvider = config.provider?.[providerID]
        if (configProvider?.blacklist?.includes(modelID)) {
          fail("Model in config blacklist")
        } else if (configProvider?.whitelist && !configProvider.whitelist.includes(modelID)) {
          fail("Model not in config whitelist")
        } else {
          pass("Config blacklist/whitelist: clear")
        }

        // 7. Check auth
        const auth = await Auth.get(providerID)
        const envKeys = providerEntry?.env ?? []
        const hasEnvKey = envKeys.some((k: string) => process.env[k])
        if (auth) {
          if (auth.type === "oauth") {
            pass(`Auth available (OAuth)`)
          } else {
            pass(`Auth available (API key)`)
          }
        } else if (hasEnvKey) {
          pass("Auth available (env var)")
        } else {
          warn("No auth configured (env var, API key, or OAuth)")
        }

        // 8. Check circuit breaker
        const cb = await CircuitBreaker.getState(providerID)
        if (cb.state === "open") {
          fail(`Circuit breaker: open (failures: ${cb.failures})`)
        } else if (cb.state === "half_open") {
          warn(`Circuit breaker: half_open (failures: ${cb.failures})`)
        } else {
          pass("Circuit breaker: closed")
        }

        // 9. Check if model shows up in final provider list
        const providers = await Provider.list()
        const liveProvider = providers[providerID]
        if (liveProvider) {
          const liveModel = liveProvider.models[modelID]
          if (liveModel) {
            pass("Model available in final provider list")
          } else {
            fail("Model filtered from final provider list (see filters above)")
          }
        } else {
          fail("Provider not loaded (no auth or all models filtered)")
        }

        process.stdout.write(EOL)
      },
    })
  },
})

function pass(msg: string) {
  process.stdout.write(`  ${UI.Style.TEXT_SUCCESS}[pass]${UI.Style.TEXT_NORMAL} ${msg}${EOL}`)
}

function fail(msg: string) {
  process.stdout.write(`  ${UI.Style.TEXT_DANGER}[FAIL]${UI.Style.TEXT_NORMAL} ${msg}${EOL}`)
}

function warn(msg: string) {
  process.stdout.write(`  ${UI.Style.TEXT_WARNING}[warn]${UI.Style.TEXT_NORMAL} ${msg}${EOL}`)
}

const ProviderListCommand = cmd({
  command: "list [provider]",
  describe: "list all available models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("all", {
        describe: "show all models including filtered ones (with filter reasons)",
        type: "boolean",
        default: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
  },
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (!args.all) {
          // Standard list
          const providers = await Provider.list()

          function printModels(providerID: string) {
            const provider = providers[providerID]
            const sortedModels = Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))
            for (const [modelID, model] of sortedModels) {
              process.stdout.write(`${providerID}/${modelID}`)
              if (args.verbose) {
                process.stdout.write(` (${model.status ?? "active"})`)
              }
              process.stdout.write(EOL)
            }
          }

          if (args.provider) {
            const provider = providers[args.provider]
            if (!provider) {
              UI.error(`Provider not found: ${args.provider}`)
              return
            }
            printModels(args.provider)
            return
          }

          for (const providerID of Object.keys(providers).sort()) {
            printModels(providerID)
          }
          return
        }

        // --all mode: show everything from models.dev including filtered models
        const modelsDev = await ModelsDev.get()
        const providers = await Provider.list()
        const config = await Config.get()
        const disabled = new Set(config.disabled_providers ?? [])

        const targetProviders = args.provider
          ? Object.entries(modelsDev).filter(([id]) => id === args.provider)
          : Object.entries(modelsDev).sort(([a], [b]) => a.localeCompare(b))

        for (const [providerID, dbProvider] of targetProviders) {
          const isProviderActive = !!providers[providerID]
          const providerBlReason = Provider.getProviderBlacklistReason(providerID)
          const isDisabled = disabled.has(providerID)

          for (const modelID of Object.keys(dbProvider.models).sort()) {
            const isLive = isProviderActive && !!providers[providerID]?.models[modelID]
            const modelBlReason = Provider.getModelBlacklistReason(providerID, modelID)
            const configBl = config.provider?.[providerID]?.blacklist?.includes(modelID)
            const model = dbProvider.models[modelID]

            let status = ""
            if (isLive) {
              status = UI.Style.TEXT_SUCCESS + "[active]" + UI.Style.TEXT_NORMAL
            } else if (providerBlReason) {
              status = UI.Style.TEXT_DANGER + `[provider blocked: ${providerBlReason}]` + UI.Style.TEXT_NORMAL
            } else if (isDisabled) {
              status = UI.Style.TEXT_DANGER + "[provider disabled]" + UI.Style.TEXT_NORMAL
            } else if (modelBlReason) {
              status = UI.Style.TEXT_DANGER + `[blocked: ${modelBlReason}]` + UI.Style.TEXT_NORMAL
            } else if (configBl) {
              status = UI.Style.TEXT_DANGER + "[config blacklist]" + UI.Style.TEXT_NORMAL
            } else if (model?.status === "deprecated") {
              status = UI.Style.TEXT_WARNING + "[deprecated]" + UI.Style.TEXT_NORMAL
            } else if (!isProviderActive) {
              status = UI.Style.TEXT_DIM + "[no auth]" + UI.Style.TEXT_NORMAL
            } else {
              status = UI.Style.TEXT_DIM + "[filtered]" + UI.Style.TEXT_NORMAL
            }

            process.stdout.write(`${providerID}/${modelID} ${status}${EOL}`)
          }
        }
      },
    })
  },
})

const ProviderRefreshCommand = cmd({
  command: "refresh",
  describe: "refresh the models cache from models.dev",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    await ModelsDev.refresh()
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
  },
})

export const ProviderCommand = cmd({
  command: "provider",
  describe: "manage providers and models",
  builder: (yargs) =>
    yargs
      .command(ProviderListCommand)
      .command(ProviderDiagnoseCommand)
      .command(ProviderRefreshCommand)
      .demandCommand(),
  async handler() {},
})
