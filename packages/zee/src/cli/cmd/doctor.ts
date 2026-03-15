import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Config } from "../../config/config"
import {
  CONTROL_UI_BREAK_GLASS_ACK,
  auditControlUiSecurity,
  auditControlUiSecurityDeep,
  emitSecurityAuditTelemetry,
} from "@/security"
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
  maxClients?: number
}

type DoctorSecurityArgs = {
  json?: boolean
  strict?: boolean
  deep?: boolean
}

function parseLimits(args: DoctorRuntimeArgs): Partial<RuntimeProcessLimits> {
  return {
    maxTotal: typeof args.maxTotal === "number" ? args.maxTotal : undefined,
    maxMcpTotal: typeof args.maxMcpTotal === "number" ? args.maxMcpTotal : undefined,
    maxMcpPerServer: typeof args.maxMcpPerServer === "number" ? args.maxMcpPerServer : undefined,
    maxClients: typeof args.maxClients === "number" ? args.maxClients : undefined,
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
        describe: "terminate orphaned/unmanaged runtime processes (daemon/gateway/MCP/clients)",
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
      })
      .option("max-clients", {
        type: "number",
        describe: "override max Zee client processes",
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
        `runtime: total=${snapshot.counts.total} daemons=${snapshot.counts.daemons} gateways=${snapshot.counts.gateways} mcp=${snapshot.counts.mcpServers} clients=${snapshot.counts.clients}`,
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

const DoctorSecurityCommand = cmd({
  command: "security",
  describe: "audit control-plane security guardrails",
  builder: (yargs: Argv) =>
    yargs
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      })
      .option("strict", {
        type: "boolean",
        default: false,
        describe: "exit with code 1 when security errors are present",
      })
      .option("deep", {
        type: "boolean",
        default: false,
        describe: "include deep checks (paired node exposure/state)",
      }),
  handler: async (args: DoctorSecurityArgs) => {
    const config = await Config.get()
    const report = args.deep ? await auditControlUiSecurityDeep(config) : auditControlUiSecurity(config)
    emitSecurityAuditTelemetry({
      source: "doctor.security",
      deep: Boolean(args.deep),
      strict: Boolean(args.strict),
      report,
    })

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            mode: "doctor-security",
            ...report,
          },
          null,
          2,
        ),
      )
    } else {
      console.log(`security: errors=${report.errors} warnings=${report.warnings}`)
      if (typeof report.metrics.totalPairedNodes === "number") {
        console.log(
          `security node-state: active=${report.metrics.activePairedNodes ?? 0} revoked=${report.metrics.revokedPairedNodes ?? 0} total=${report.metrics.totalPairedNodes}`,
        )
      }
      if (
        (report.metrics.unknownStatusNodes ?? 0) > 0 ||
        (report.metrics.duplicateTokenHashes ?? 0) > 0 ||
        (report.metrics.missingTokenHashes ?? 0) > 0 ||
        (report.metrics.activeNodesMissingLastSeen ?? 0) > 0 ||
        (report.metrics.revokedNodesMissingTimestamp ?? 0) > 0 ||
        (report.metrics.revokedNodesMissingReason ?? 0) > 0
      ) {
        console.log(
          `security node-state anomalies: unknownStatus=${report.metrics.unknownStatusNodes ?? 0} duplicateTokenHashes=${report.metrics.duplicateTokenHashes ?? 0} missingTokenHashes=${report.metrics.missingTokenHashes ?? 0} activeMissingLastSeen=${report.metrics.activeNodesMissingLastSeen ?? 0} revokedMissingTimestamp=${report.metrics.revokedNodesMissingTimestamp ?? 0} revokedMissingReason=${report.metrics.revokedNodesMissingReason ?? 0}`,
        )
      }
      if (report.findings.length === 0) {
        console.log("security: healthy")
      } else {
        console.log("security findings:")
        for (const finding of report.findings) {
          console.log(`- [${finding.severity}] ${finding.code}: ${finding.message}`)
          if (finding.remediation) {
            console.log(`  remediation: ${finding.remediation}`)
          }
        }
      }
      console.log(`security: break-glass ack value is ${CONTROL_UI_BREAK_GLASS_ACK}`)
    }

    if (args.strict && !report.ok) {
      process.exit(1)
    }
  },
})

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "diagnose and repair runtime issues",
  builder: (yargs: Argv) => yargs.command(DoctorRuntimeCommand).command(DoctorSecurityCommand).demandCommand(),
  async handler() {},
})
