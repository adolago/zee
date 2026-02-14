import type { Argv } from "yargs"
import { cmd } from "./cmd"
import {
  RUN_MODES,
  defaultRunMode,
  getSavedRunMode,
  parseRunMode,
  setSavedRunMode,
} from "../run-mode"

type ModeSetArgs = {
  mode?: string
  json?: boolean
}

type ModeGetArgs = {
  json?: boolean
}

const ModeGetCommand = cmd({
  command: "get",
  describe: "show the default run mode",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  handler: async (args: ModeGetArgs) => {
    const saved = await getSavedRunMode()
    const fallback = defaultRunMode()
    const effective = saved ?? fallback

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            mode: effective,
            source: saved ? "saved" : "default",
            default: fallback,
          },
          null,
          2,
        ),
      )
      return
    }

    if (saved) {
      console.log(`Default run mode: ${saved}`)
      return
    }

    console.log(`Default run mode: ${fallback} (implicit default)`)
  },
})

const ModeSetCommand = cmd({
  command: "set <mode>",
  describe: "set the default run mode",
  builder: (yargs: Argv) =>
    yargs
      .positional("mode", {
        type: "string",
        choices: RUN_MODES,
        describe: "default run mode",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: ModeSetArgs) => {
    const mode = parseRunMode(args.mode)
    if (!mode) {
      console.error(`Invalid mode: ${String(args.mode)} (use: ${RUN_MODES.join(", ")})`)
      process.exit(2)
    }

    const filepath = await setSavedRunMode(mode)

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            mode,
            saved: true,
            path: filepath,
          },
          null,
          2,
        ),
      )
      return
    }

    console.log(`Default run mode set to ${mode}`)
  },
})

export const ModeCommand = cmd({
  command: "mode",
  describe: "manage default run mode",
  builder: (yargs: Argv) => yargs.command(ModeGetCommand).command(ModeSetCommand).demandCommand(),
  async handler() {},
})
