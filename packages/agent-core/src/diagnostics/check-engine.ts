/**
 * @file Check Engine
 * @description Orchestrates all health checks across categories
 */

import * as os from "os";
import type {
  CheckResult,
  CheckOptions,
  CheckReport,
  CheckCategory,
  CategorySummary,
  FixResult,
} from "./types";
import { runRuntimeChecks } from "./checks/runtime";
import { runConfigChecks } from "./checks/config";
import { runProviderChecks } from "./checks/providers";
import { runIntegrityChecks } from "./checks/integrity";
import { runSkillChecks } from "./checks/skills";

/** Default options for the check engine */
const DEFAULT_OPTIONS: CheckOptions = {
  full: false,
  fix: false,
  verbose: false,
  timeout: 10000,
};

/**
 * Main engine that orchestrates all health checks
 */
export class CheckEngine {
  private options: CheckOptions;

  constructor(options: Partial<CheckOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Run all health checks across all categories
   */
  async runAll(): Promise<CheckReport> {
    const startTime = Date.now();
    const allResults: CheckResult[] = [];
    const fixes: FixResult[] = [];

    const categories =
      this.options.categories ||
      (["runtime", "config", "providers", "integrity", "skills"] as CheckCategory[]);

    // Run categories sequentially to avoid resource contention
    for (const category of categories) {
      const results = await this.runCategory(category);

      // Filter out skipped checks if configured
      const filteredResults = results.filter((r) => {
        if (this.options.skip?.includes(r.id)) {
          return false;
        }
        return true;
      });

      allResults.push(...filteredResults);
    }

    // Apply auto-fixes if requested
    if (this.options.fix) {
      for (const result of allResults) {
        if (result.autoFixable && result.fix && result.status !== "pass") {
          try {
            const fixResult = await result.fix();
            fixes.push(fixResult);

            if (fixResult.success) {
              result.status = "pass";
              result.message = `[FIXED] ${result.message}`;
            }
          } catch (error) {
            fixes.push({
              success: false,
              message: `Fix failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }
      }
    }

    return this.buildReport(allResults, fixes, Date.now() - startTime);
  }

  /**
   * Run checks for a specific category with timeout
   */
  private async runCategory(category: CheckCategory): Promise<CheckResult[]> {
    const runners: Record<CheckCategory, () => Promise<CheckResult[]>> = {
      runtime: () => runRuntimeChecks(this.options),
      config: () => runConfigChecks(this.options),
      providers: () => runProviderChecks(this.options),
      integrity: () => runIntegrityChecks(this.options),
      skills: () => runSkillChecks(this.options),
    };

    try {
      return await Promise.race([
        runners[category](),
        new Promise<CheckResult[]>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), this.options.timeout)
        ),
      ]);
    } catch (error) {
      return [
        {
          id: `${category}.error`,
          name: `${category} checks`,
          category,
          status: "fail",
          message: `Category failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          severity: "error",
          durationMs: this.options.timeout,
          autoFixable: false,
        },
      ];
    }
  }

  /**
   * Build the final report from all check results
   */
  private buildReport(
    results: CheckResult[],
    fixes: FixResult[],
    durationMs: number
  ): CheckReport {
    const categories: Record<CheckCategory, CategorySummary> = {
      runtime: { status: "ok", passed: 0, total: 0, checks: [] },
      config: { status: "ok", passed: 0, total: 0, checks: [] },
      providers: { status: "ok", passed: 0, total: 0, checks: [] },
      integrity: { status: "ok", passed: 0, total: 0, checks: [] },
      skills: { status: "ok", passed: 0, total: 0, checks: [] },
    };

    let passed = 0,
      warnings = 0,
      failed = 0,
      skipped = 0;

    for (const result of results) {
      const cat = categories[result.category];
      cat.checks.push(result);
      cat.total++;

      switch (result.status) {
        case "pass":
          passed++;
          cat.passed++;
          break;
        case "warn":
          warnings++;
          if (cat.status === "ok") cat.status = "warning";
          break;
        case "fail":
          failed++;
          cat.status = "error";
          break;
        case "skip":
          skipped++;
          break;
      }
    }

    const clampedDurationMs = Math.max(1, durationMs);

    return {
      timestamp: new Date().toISOString(),
      version: process.env.AGENT_CORE_VERSION || "dev",
      hostname: os.hostname(),
      summary: {
        total: results.length,
        passed,
        warnings,
        failed,
        skipped,
        fixed: fixes.filter((f) => f.success).length,
      },
      categories,
      checks: results,
      fixes,
      durationMs: clampedDurationMs,
    };
  }
}
