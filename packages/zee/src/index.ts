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
import { NamedError } from "@zee/util/error"
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
import { DaemonEventsCommand } from "./cli/cmd/daemon-events"
import { DaemonInstallCommand, DaemonUninstallCommand, DaemonServiceStatusCommand } from "./cli/cmd/daemon-install"
import { PluginCommand } from "./cli/cmd/plugin"
import { SetupCommand } from "./cli/cmd/setup"
import { PodsCommand } from "./cli/cmd/pods"
import { PackageCommand } from "./cli/cmd/package"
import { InspectCommand } from "./cli/cmd/inspect"
import { BugReportCommand } from "./cli/cmd/bug-report"
import { CheckCommand } from "./cli/cmd/check"
import { DoctorCommand } from "./cli/cmd/doctor"
import { SecurityCommand } from "./cli/cmd/security"
import { ProviderCommand } from "./cli/cmd/provider"
import { ReliabilityCommand } from "./cli/cmd/reliability"
import { ClientCommand } from "./cli/cmd/client"
import { InvestingCommand } from "./cli/cmd/investing"
import { GatewayCommand } from "./cli/cmd/gateway"
import { ChannelsCommand } from "./cli/cmd/channels"
import { GuiCommand } from "./cli/cmd/gui"
import { ControlUiCommand } from "./cli/cmd/control-ui"
import { WebCommand } from "./cli/cmd/web"
import { DmuxCommand } from "./cli/cmd/dmux"
import { V3Command } from "./cli/cmd/v3"
import { BenchmarkCommand } from "./cli/cmd/benchmark"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { reloadFlags } from "./flag/flag"
import { resolveConfigDir } from "./global/dirs"
import { installParentProcessGuard } from "./process/parent-guard"

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadDaemonEnv()
reloadFlags()
const parentProcessGuard = installParentProcessGuard({ guardName: "zee-cli" })

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
  .scriptName("zee")
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
  .option("session-control", {
    describe: "enable cross-session control socket APIs",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (!process.env.ZEE_ROOT) {
      const rootCandidate = path.resolve(path.dirname(process.execPath), "..")
      if (fs.existsSync(path.join(rootCandidate, ".zee"))) {
        process.env.ZEE_ROOT = rootCandidate
      }
    }

    if (!process.env.ZEE_ROOT) {
      try {
        const here = path.dirname(fileURLToPath(import.meta.url))
        const monorepoRoot = path.resolve(here, "../../..")
        const rootConfigDir = path.join(monorepoRoot, ".zee")
        if (fs.existsSync(rootConfigDir)) {
          process.env.ZEE_ROOT = monorepoRoot
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
    process.env.ZEE = "1"
    if (opts.sessionControl === true) {
      process.env.ZEE_SESSION_CONTROL = "1"
      reloadFlags()
    }

    Log.Default.info("zee", {
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
  .command(ClientCommand)
  .command(InvestingCommand)
  .command(GuiCommand)
  .command(ControlUiCommand)
  .command(WebCommand)
  .command(DmuxCommand)
  .command(RunCommand)
  .command(CheckCommand)
  .command(DoctorCommand)
  .command(InspectCommand)
  .command(SecurityCommand)
  .command(InspectCommand)
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
  .command(DaemonEventsCommand)
  .command(DaemonStatusCommand)
  .command(DaemonStopCommand)
  .command(DaemonInstallCommand)
  .command(DaemonUninstallCommand)
  .command(DaemonServiceStatusCommand)
  .command(GatewayStatusCommand)
  .command(GatewayCommand)
  .command(ChannelsCommand)
  .command(PluginCommand)
  .command(ProviderCommand)
  .command(SetupCommand)
  .command(PodsCommand)
  .command(PackageCommand)
  .command(PodsCommand)
  .command(BugReportCommand)
  .command(ReliabilityCommand)
  .command(BenchmarkCommand)
  .command(V3Command)
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
  parentProcessGuard?.stop()
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
