import type { Argv } from "yargs"
import { Config } from "../../config/config"
import { CONTROL_UI_BREAK_GLASS_ACK, auditControlUiSecurity } from "@/security"
import { cmd } from "./cmd"

type SecurityAuditArgs = {
  json?: boolean
  strict?: boolean
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
      }),
  handler: async (args: SecurityAuditArgs) => {
    const config = await Config.get()
    const report = auditControlUiSecurity(config)

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`security: errors=${report.errors} warnings=${report.warnings}`)
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
