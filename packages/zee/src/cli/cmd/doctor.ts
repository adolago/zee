import type { Argv } from "yargs"
import { cmd } from "./cmd"
import {
  type RuntimeProcessLimits,
  resolveRuntimeProcessLimits,
  runRuntimeProcessMaintenance,
} from "./runtime-process-guard"

type DoctorRuntimeArgs = {
  json?: boolean
  fix?: boolean
  strict?: boolean
  maxTotal?: number
  maxMcpTotal?: number
  maxMcpPerServer?: number
}

function parseLimits(args: DoctorRuntimeArgs): Partial<RuntimeProcessLimits> {
  return {
    maxTotal: typeof args.maxTotal === "number" ? args.maxTotal : undefined,
    maxMcpTotal: typeof args.maxMcpTotal === "number" ? args.maxMcpTotal : undefined,
    maxMcpPerServer: typeof args.maxMcpPerServer === "number" ? args.maxMcpPerServer : undefined,
  }
}

const DoctorRuntimeCommand = cmd({
  command: "runtime",
  describe: "inspect and optionally repair runtime process state",
  builder: (yargs: Argv) =>
    yargs
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      })
      .option("fix", {
        type: "boolean",
        default: false,
        describe: "terminate orphaned/unmanaged runtime processes (daemon/gateway/MCP)",
      })
      .option("strict", {
        type: "boolean",
        default: false,
        describe: "exit with code 1 when violations are present",
      })
      .option("max-total", {
        type: "number",
        describe: "override max total Zee-related processes",
      })
      .option("max-mcp-total", {
        type: "number",
        describe: "override max total MCP server processes",
      })
      .option("max-mcp-per-server", {
        type: "number",
        describe: "override max MCP processes per server",
      }),
  handler: async (args: DoctorRuntimeArgs) => {
    const limits = resolveRuntimeProcessLimits(parseLimits(args))

    const report = await runRuntimeProcessMaintenance({
      limits,
      dryRun: !args.fix,
      reason: "doctor-runtime",
    })

    const snapshot = args.fix ? report.snapshotAfter : report.snapshotBefore

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            mode: args.fix ? "fix" : "inspect",
            limits,
            snapshot,
            kills: report.kills,
          },
          null,
          2,
        ),
      )
    } else {
      console.log(
        `runtime: total=${snapshot.counts.total} daemons=${snapshot.counts.daemons} gateways=${snapshot.counts.gateways} mcp=${snapshot.counts.mcpServers}`,
      )
      if (snapshot.violations.length === 0) {
        console.log("runtime: healthy")
      } else {
        console.log("runtime violations:")
        for (const violation of snapshot.violations) {
          console.log(`- ${violation}`)
        }
      }

      if (report.kills.length > 0) {
        console.log("maintenance actions:")
        for (const kill of report.kills) {
          console.log(`- pid=${kill.pid} reason=${kill.reason} result=${kill.result}`)
        }
      } else if (args.fix) {
        console.log("maintenance actions: none")
      }
    }

    if (args.strict && snapshot.violations.length > 0) {
      process.exit(1)
    }
  },
})

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "diagnose and repair runtime issues",
  builder: (yargs: Argv) => yargs.command(DoctorRuntimeCommand).demandCommand(),
  async handler() {},
})
