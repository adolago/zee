/**
 * @file JSON Reporter
 * @description Machine-readable JSON output for CI/scripting
 */

import type { CheckReport } from "../types";

export class JsonReporter {
  private pretty: boolean;

  constructor(options: { pretty?: boolean } = {}) {
    this.pretty = options.pretty ?? true;
  }

  format(report: CheckReport): string {
    // Remove fix functions from results (not serializable)
    const sanitized = {
      ...report,
      checks: report.checks.map(({ fix, ...rest }) => rest),
    };

    return this.pretty
      ? JSON.stringify(sanitized, null, 2)
      : JSON.stringify(sanitized);
  }
}
