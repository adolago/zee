/**
 * @file Diagnostics Collector
 * @description Runs abbreviated health checks for crash reports
 */

import { CheckEngine } from "../../diagnostics/check-engine";
import type { DiagnosticSummary } from "../types";

/**
 * Collect diagnostic summary
 */
export async function collectDiagnostics(): Promise<DiagnosticSummary> {
  try {
    const engine = new CheckEngine({
      full: false,
      fix: false,
      verbose: false,
      timeout: 5000,
    });

    const report = await engine.runAll();

    return {
      status:
        report.summary.failed > 0
          ? "error"
          : report.summary.warnings > 0
            ? "warning"
            : "ok",
      passed: report.summary.passed,
      warnings: report.summary.warnings,
      failed: report.summary.failed,
      checks: report.checks.map((c) => ({
        id: c.id,
        status: c.status,
        message: c.message,
      })),
    };
  } catch (error) {
    return {
      status: "error",
      passed: 0,
      warnings: 0,
      failed: 1,
      checks: [
        {
          id: "diagnostics.error",
          status: "fail",
          message: `Diagnostics failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
