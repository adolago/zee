import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { ConfigCommand } from "./config"
import { ErrorsCommand } from "./errors"
import { FileCommand } from "./file"
import { LSPCommand } from "./lsp"
import { LogsCommand } from "./logs"
import { MemoryCommand } from "./memory"
import { MigrateCommand } from "./migrate"
import { RipgrepCommand } from "./ripgrep"
import { ScrapCommand } from "./scrap"
import { SkillCommand } from "./skill"
import { SnapshotCommand } from "./snapshot"
import { StatusCommand } from "./status"
import { TasksCommand } from "./tasks"
import { AgentCommand } from "./agent"
import { ContextTaxCommand } from "./context-tax"
import { SkillAuditCommand } from "./skill-audit"
import { PathsCommand } from "../paths"

export const DebugCommand = cmd({
  command: "debug",
  describe: "debugging and troubleshooting tools",
  builder: (yargs) =>
    yargs
      .command(ConfigCommand)
      .command(ContextTaxCommand)
      .command(ErrorsCommand)
      .command(LSPCommand)
      .command(LogsCommand)
      .command(MemoryCommand)
      .command(MigrateCommand)
      .command(RipgrepCommand)
      .command(FileCommand)
      .command(ScrapCommand)
      .command(SkillCommand)
      .command(SkillAuditCommand)
      .command(SnapshotCommand)
      .command(TasksCommand)
      .command(AgentCommand)
      .command(StatusCommand)
      .command(PathsCommand)
      .command(FlagsCommand)
      .command({
        command: "wait",
        describe: "wait indefinitely (for debugging)",
        async handler() {
          await bootstrap(process.cwd(), async () => {
            await new Promise((resolve) => setTimeout(resolve, 1_000 * 60 * 60 * 24))
          })
        },
      })
      .demandCommand(),
  async handler() {},
})

const FlagsCommand = cmd({
  command: "flags",
  describe: "list all environment flags and their current values",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "output as JSON",
    }),
  async handler(args) {
    const { Flag } = await import("../../../flag/flag")

    // Essential configurable flags (most are hardcoded for personal use)
    const flagNames = [
      "CONFIG",
      "CONFIG_DIR",
      "PERMISSION",
      "GIT_BASH_PATH",
      "CLIENT",
      "EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS",
      "EXPERIMENTAL_OUTPUT_TOKEN_MAX",
    ]

    const flags = flagNames.map((name) => {
      const primaryKey = `ZEE_${name}`
      const primaryValue = process.env[primaryKey]
      // Get value from Flag namespace if available
      const flagKey = `ZEE_${name}` as keyof typeof Flag
      const computedValue = Flag[flagKey]

      return {
        name,
        env: primaryKey,
        envValue: primaryValue ?? null,
        computedValue: computedValue !== undefined ? String(computedValue) : null,
        source: primaryValue ? "ZEE" : null,
      }
    })

    if (args.json) {
      console.log(JSON.stringify(flags, null, 2))
      return
    }

    console.log("Environment Flags")
    console.log("=================")
    console.log("")
    console.log("Use ZEE_* prefix")
    console.log("")

    const setFlags = flags.filter((f) => f.envValue !== null || f.computedValue === "true")
    const unsetFlags = flags.filter((f) => f.envValue === null && f.computedValue !== "true")

    if (setFlags.length > 0) {
      console.log("Currently Set:")
      for (const flag of setFlags) {
        const value = flag.envValue ?? flag.computedValue
        const source = flag.source ?? "default"
        console.log(`  ${flag.name.padEnd(45)} = ${value} (${source})`)
      }
      console.log("")
    }

    console.log("Available Flags:")
    for (const flag of unsetFlags) {
      console.log(`  ${flag.name}`)
    }
  },
})
