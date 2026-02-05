import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { Log } from "./util/log"
import { AuthCommand } from "./cli/cmd/auth"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { NamedError } from "@agent-core/util/error"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { DebugCommand } from "./cli/cmd/debug"
import { PathsCommand } from "./cli/cmd/paths"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { GithubCommand } from "./cli/cmd/github"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/tui/attach"
import { TuiThreadCommand } from "./cli/cmd/tui/thread"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DaemonCommand, DaemonStatusCommand, DaemonStopCommand, GatewayStatusCommand } from "./cli/cmd/daemon"
import { DaemonInstallCommand, DaemonUninstallCommand, DaemonServiceStatusCommand } from "./cli/cmd/daemon-install"
import { PluginCommand } from "./cli/cmd/plugin"
import { SetupCommand } from "./cli/cmd/setup"
import { BugReportCommand } from "./cli/cmd/bug-report"
import { CheckCommand } from "./cli/cmd/check"
import { ProviderCommand } from "./cli/cmd/provider"
import { ClawHubCommand } from "./cli/cmd/clawhub"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { reloadFlags } from "./flag/flag"
import { resolveConfigDir } from "./global/dirs"

function loadDaemonEnv(): void {
  const configDir = resolveConfigDir()
  const envPath = path.join(configDir, "daemon.env")
  if (!fs.existsSync(envPath)) return

  const content = fs.readFileSync(envPath, "utf-8")
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trim()
    }
    const eqIndex = line.indexOf("=")
    if (eqIndex <= 0) continue
    const key = line.slice(0, eqIndex).trim()
    if (!key || process.env[key] !== undefined) continue
    let value = line.slice(eqIndex + 1).trim()
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadDaemonEnv()
reloadFlags()

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

const cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("agent-core")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .middleware(async (opts) => {
    // Backward compat: migrate OPENCODE_ROOT to AGENT_CORE_ROOT
    if (!process.env.AGENT_CORE_ROOT && process.env.OPENCODE_ROOT) {
      process.env.AGENT_CORE_ROOT = process.env.OPENCODE_ROOT
    }

    if (!process.env.AGENT_CORE_ROOT) {
      const rootCandidate = path.resolve(path.dirname(process.execPath), "..")
      if (fs.existsSync(path.join(rootCandidate, "vendor", "personas"))) {
        process.env.AGENT_CORE_ROOT = rootCandidate
      }
    }

    if (!process.env.AGENT_CORE_ROOT) {
      try {
        const here = path.dirname(fileURLToPath(import.meta.url))
        const monorepoRoot = path.resolve(here, "../../..")
        const rootConfigDir = path.join(monorepoRoot, ".agent-core")
        if (fs.existsSync(rootConfigDir)) {
          process.env.AGENT_CORE_ROOT = monorepoRoot
        }
      } catch {
        // ignore
      }
    }

    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    process.env.AGENT = "1"
    process.env.AGENT_CORE = "1"
    process.env.OPENCODE = "1" // backwards compatibility

    Log.Default.info("agent-core", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })
  })
  .usage("\n" + UI.logo())
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(CheckCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(PathsCommand)
  .command(AuthCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(DaemonCommand)
  .command(DaemonStatusCommand)
  .command(DaemonStopCommand)
  .command(DaemonInstallCommand)
  .command(DaemonUninstallCommand)
  .command(DaemonServiceStatusCommand)
  .command(GatewayStatusCommand)
  .command(PluginCommand)
  .command(ProviderCommand)
  .command(SetupCommand)
  .command(BugReportCommand)
  .command(ClawHubCommand)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    console.error(e instanceof Error ? e.message : String(e))
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
