import { cmd } from "./cmd"
import { Output } from "../output"

type RuntimeEnv = {
  log: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  exit: (code: number) => never
}

let runtimePromise: Promise<RuntimeEnv> | null = null

async function ensureChannelsRuntime(): Promise<RuntimeEnv> {
  if (runtimePromise) return runtimePromise

  runtimePromise = (async () => {
    const [
      configMod,
      agentScopeMod,
      pluginsLoaderMod,
      runtimeMod,
    ] = await Promise.all([
      import("../../../Swabble/src/config/config"),
      import("../../../Swabble/src/agents/agent-scope"),
      import("../../../Swabble/src/plugins/loader"),
      import("../../../Swabble/src/runtime"),
    ])

    const cfg = configMod.loadConfig()
    const workspaceDir = agentScopeMod.resolveAgentWorkspaceDir(
      cfg,
      agentScopeMod.resolveDefaultAgentId(cfg),
    )

    pluginsLoaderMod.loadZeePlugins({
      config: cfg,
      workspaceDir,
    })

    return runtimeMod.defaultRuntime as RuntimeEnv
  })()

  return runtimePromise
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runChannelsAction(action: (runtime: RuntimeEnv) => Promise<void>) {
  try {
    const runtime = await ensureChannelsRuntime()
    await action(runtime)
  } catch (error) {
    Output.error(`Channels command failed: ${formatError(error)}`)
    process.exit(1)
  }
}

const ChannelsListCommand = cmd({
  command: "list",
  describe: "List configured channels + auth profiles",
  builder: (yargs) =>
    yargs
      .option("usage", {
        type: "boolean",
        default: true,
        describe: "Include model provider usage/quota snapshots",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (args) => {
    await runChannelsAction(async (runtime) => {
      const mod = await import("../../../Swabble/src/commands/channels")
      await mod.channelsListCommand(
        {
          usage: Boolean(args.usage),
          json: Boolean(args.json),
        },
        runtime,
      )
    })
  },
})

const ChannelsStatusCommand = cmd({
  command: "status",
  describe: "Show gateway channel status",
  builder: (yargs) =>
    yargs
      .option("probe", {
        type: "boolean",
        default: false,
        describe: "Probe channel credentials",
      })
      .option("timeout", {
        type: "string",
        default: "10000",
        describe: "Timeout in ms",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (args) => {
    await runChannelsAction(async (runtime) => {
      const mod = await import("../../../Swabble/src/commands/channels")
      await mod.channelsStatusCommand(
        {
          probe: Boolean(args.probe),
          timeout: String(args.timeout ?? "10000"),
          json: Boolean(args.json),
        },
        runtime,
      )
    })
  },
})

const ChannelsCapabilitiesCommand = cmd({
  command: "capabilities",
  describe: "Show provider capabilities (intents/scopes + supported features)",
  builder: (yargs) =>
    yargs
      .option("channel", {
        type: "string",
        describe: "Channel (whatsapp|telegram|slack|discord|all)",
      })
      .option("account", {
        type: "string",
        describe: "Account id (only with --channel)",
      })
      .option("timeout", {
        type: "string",
        default: "10000",
        describe: "Timeout in ms",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (args) => {
    await runChannelsAction(async (runtime) => {
      const mod = await import("../../../Swabble/src/commands/channels")
      await mod.channelsCapabilitiesCommand(
        {
          channel: typeof args.channel === "string" ? args.channel : undefined,
          account: typeof args.account === "string" ? args.account : undefined,
          timeout: String(args.timeout ?? "10000"),
          json: Boolean(args.json),
        },
        runtime,
      )
    })
  },
})

const ChannelsLoginCommand = cmd({
  command: "login",
  describe: "Link a channel account (if supported)",
  builder: (yargs) =>
    yargs
      .option("channel", {
        type: "string",
        describe: "Channel alias (default: whatsapp)",
      })
      .option("account", {
        type: "string",
        describe: "Account id",
      })
      .option("verbose", {
        type: "boolean",
        default: false,
        describe: "Verbose connection logs",
      }),
  handler: async (args) => {
    await runChannelsAction(async (runtime) => {
      const mod = await import("../../../Swabble/src/cli/channel-auth")
      await mod.runChannelLogin(
        {
          channel: typeof args.channel === "string" ? args.channel : undefined,
          account: typeof args.account === "string" ? args.account : undefined,
          verbose: Boolean(args.verbose),
        },
        runtime,
      )
    })
  },
})

const ChannelsLogoutCommand = cmd({
  command: "logout",
  describe: "Log out of a channel session (if supported)",
  builder: (yargs) =>
    yargs
      .option("channel", {
        type: "string",
        describe: "Channel alias (default: whatsapp)",
      })
      .option("account", {
        type: "string",
        describe: "Account id",
      }),
  handler: async (args) => {
    await runChannelsAction(async (runtime) => {
      const mod = await import("../../../Swabble/src/cli/channel-auth")
      await mod.runChannelLogout(
        {
          channel: typeof args.channel === "string" ? args.channel : undefined,
          account: typeof args.account === "string" ? args.account : undefined,
        },
        runtime,
      )
    })
  },
})

export const ChannelsCommand = cmd({
  command: "channels",
  describe: "Manage chat channel accounts",
  builder: (yargs) =>
    yargs
      .command(ChannelsListCommand)
      .command(ChannelsStatusCommand)
      .command(ChannelsCapabilitiesCommand)
      .command(ChannelsLoginCommand)
      .command(ChannelsLogoutCommand)
      .demandCommand(1, "Please specify a channels subcommand"),
  async handler() {},
})
