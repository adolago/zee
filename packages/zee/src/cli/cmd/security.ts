import type { Argv } from "yargs"
import { Config } from "../../config/config"
import { bootstrap } from "../bootstrap"
import {
  CONTROL_UI_BREAK_GLASS_ACK,
  auditControlUiSecurity,
  auditControlUiSecurityDeep,
} from "@/security"
import { cmd } from "./cmd"

type SecurityAuditArgs = {
  json?: boolean
  strict?: boolean
  deep?: boolean
}

const SecurityAuditCommand = cmd({
  command: "audit",
  describe: "audit security-sensitive control-plane settings",
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
        describe: "exit with code 1 when errors are present",
      })
      .option("deep", {
        type: "boolean",
        default: false,
        describe: "include deep checks (paired node exposure/state)",
      }),
  handler: async (args: SecurityAuditArgs) => {
    const report = await bootstrap(process.cwd(), async () => {
      const config = await Config.get()
      return args.deep ? await auditControlUiSecurityDeep(config) : auditControlUiSecurity(config)
    })

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
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
      if (report.alerts.length > 0) {
        console.log("security alerts:")
        for (const alert of report.alerts) {
          console.log(`- [${alert.severity}] ${alert.code}: ${alert.message}`)
          for (const [index, step] of alert.runbook.entries()) {
            console.log(`  ${index + 1}. ${step}`)
          }
        }
      }
      if (report.findings.length === 0) {
        console.log("security: no findings")
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

export const SecurityCommand = cmd({
  command: "security",
  describe: "security diagnostics and audits",
  builder: (yargs: Argv) => yargs.command(SecurityAuditCommand).demandCommand(),
  async handler() {},
})
