import { cmd } from "./cmd"
import { Output } from "../output"

const REMOVED_MSG = "Channels commands are not available (Swabble gateway removed). Use wacli for WhatsApp."

const ChannelsListCommand = cmd({
  command: "list",
  describe: "List configured channels + auth profiles",
  builder: (yargs) =>
    yargs
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async () => {
    Output.error(REMOVED_MSG)
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
  handler: async () => {
    Output.error(REMOVED_MSG)
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
  handler: async () => {
    Output.error(REMOVED_MSG)
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
  handler: async () => {
    Output.error(REMOVED_MSG)
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
  handler: async () => {
    Output.error(REMOVED_MSG)
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
