/**
 * @file Minimal Reporter
 * @description Single-line output for scripts and CI
 */

import type { CheckReport } from "../types";

export class MinimalReporter {
  format(report: CheckReport): string {
    const { passed, warnings, failed, skipped, total } = report.summary;
    
    if (failed > 0) {
      return `FAIL: ${failed}/${total} checks failed`;
    }
    if (warnings > 0) {
      return `WARN: ${warnings}/${total} checks have warnings`;
    }
    return `OK: ${passed}/${total} checks passed`;
  }
}
