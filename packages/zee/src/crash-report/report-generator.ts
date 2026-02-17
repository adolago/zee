/**
 * @file Report Generator
 * @description Main crash report generation logic
 */

import * as path from "path"
import * as os from "os"
import { PrivacyRedactor } from "./privacy/redactor"
import { ZipBuilder } from "./archive/zip-builder"
import { collectSystemInfo, collectConfig, collectLogs, collectSession, collectDiagnostics } from "./collectors"
import { Output } from "../cli/output"
import type { CrashReport, CrashReportOptions, ReportMeta } from "./types"

const REPORT_VERSION = "1.0.0"

export class ReportGenerator {
  private options: CrashReportOptions
  private redactor: PrivacyRedactor

  constructor(options: Partial<CrashReportOptions> = {}) {
    this.options = {
      includeSession: options.includeSession ?? false,
      logLines: options.logLines ?? 500,
      outputPath: options.outputPath,
      skipDiagnostics: options.skipDiagnostics ?? false,
      anonymization: options.anonymization ?? "standard",
      nonInteractive: options.nonInteractive ?? false,
    }
    this.redactor = new PrivacyRedactor(this.options.anonymization)
  }

  /**
   * Generate a complete crash report
   */
  async generate(): Promise<{ report: CrashReport; archivePath: string }> {
    Output.log("Generating crash report...\n")

    // Collect all data
    Output.log("  * Collecting system info...")
    const system = await collectSystemInfo()

    Output.log("  * Collecting configuration...")
    const config = await collectConfig(this.redactor)

    Output.log("  * Collecting logs...")
    const logs = await collectLogs(this.redactor, { lineCount: this.options.logLines })

    let session
    if (this.options.includeSession) {
      Output.log("  * Collecting session data...")
      session = await collectSession(this.redactor)
    }

    let diagnostics
    if (!this.options.skipDiagnostics) {
      Output.log("  * Running diagnostics...")
      diagnostics = await collectDiagnostics()
    }

    // Build report
    const report: CrashReport = {
      meta: this.createMeta(),
      system,
      config,
      session,
      diagnostics,
      logs,
      redactionStats: this.redactor.getStats(),
    }

    // Create archive
    Output.log("\n  * Creating archive...")
    const archivePath = await this.createArchive(report)

    Output.log(`\n+ Report generated: ${archivePath}`)
    Output.log(`   Redacted ${report.redactionStats.totalRedactions} sensitive items\n`)

    return { report, archivePath }
  }

  private createMeta(): ReportMeta {
    return {
      version: REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      id: `crash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      zeeVersion: process.env.ZEE_VERSION || "dev",
      anonymization: this.options.anonymization,
    }
  }

  private async createArchive(report: CrashReport): Promise<string> {
    const outputPath = this.options.outputPath || path.join(os.homedir(), `zee-report-${report.meta.id}.tar.gz`)

    const builder = new ZipBuilder(outputPath)

    // Add main report
    builder.addJson("report.json", report)

    // Add readable summary
    builder.addText("README.md", this.createReadme(report))

    // Add separate files for large sections
    if (report.logs.length > 0) {
      builder.addJson("logs.json", report.logs)
    }

    if (report.session) {
      builder.addJson("session.json", report.session)
    }

    if (report.diagnostics) {
      builder.addJson("diagnostics.json", report.diagnostics)
    }

    return builder.finalize()
  }

  private createReadme(report: CrashReport): string {
    return `# Zee Crash Report

## Report Info
- **ID**: ${report.meta.id}
- **Generated**: ${report.meta.generatedAt}
- **Version**: ${report.meta.zeeVersion}
- **Anonymization**: ${report.meta.anonymization}

## System
- **OS**: ${report.system.os.type} ${report.system.os.release} (${report.system.os.arch})
- **Runtime**: Bun ${report.system.runtime.bun}
- **Shell**: ${report.system.shell}
- **Memory**: ${report.system.resources.memoryMB} MB available
- **CPUs**: ${report.system.resources.cpuCores}

## Configuration
- **Providers**: ${report.config.providers.join(", ") || "none"}
- **MCP Servers**: ${report.config.mcpServerCount}
- **Custom Keybinds**: ${report.config.customKeybinds}

## Diagnostics
${
  report.diagnostics
    ? `- **Status**: ${report.diagnostics.status}
- **Passed**: ${report.diagnostics.passed}
- **Warnings**: ${report.diagnostics.warnings}
- **Failed**: ${report.diagnostics.failed}`
    : "Diagnostics were skipped"
}

## Privacy
This report has been sanitized:
- ${report.redactionStats.totalRedactions} items redacted
- Patterns: ${Object.keys(report.redactionStats.byPattern).join(", ") || "none triggered"}

## Files in this Archive
- \`report.json\` - Complete structured report
- \`logs.json\` - Recent log entries
- \`session.json\` - Session replay (if included)
- \`diagnostics.json\` - Health check results

## How to Share
1. Review the contents for any remaining sensitive data
2. Attach this archive to a GitHub issue
3. Describe the problem you encountered
`
  }
}
