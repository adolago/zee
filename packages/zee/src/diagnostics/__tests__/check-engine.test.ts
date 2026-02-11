/**
 * @file Check Engine Tests
 * @description Unit tests for the CheckEngine class
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { CheckEngine } from "../check-engine";
import type { CheckResult, CheckOptions } from "../types";

// Mock the check runners
mock.module("../checks/runtime", () => ({
  runRuntimeChecks: async (): Promise<CheckResult[]> => [
    {
      id: "runtime.bun-version",
      name: "Bun Version",
      category: "runtime",
      status: "pass",
      message: "Bun 1.1.0",
      severity: "info",
      durationMs: 10,
      autoFixable: false,
    },
  ],
}));

mock.module("../checks/config", () => ({
  runConfigChecks: async (): Promise<CheckResult[]> => [
    {
      id: "config.schema",
      name: "Config Schema",
      category: "config",
      status: "pass",
      message: "Valid",
      severity: "info",
      durationMs: 5,
      autoFixable: false,
    },
  ],
}));

mock.module("../checks/providers", () => ({
  runProviderChecks: async (): Promise<CheckResult[]> => [
    {
      id: "providers.internet",
      name: "Internet",
      category: "providers",
      status: "pass",
      message: "Connected",
      severity: "info",
      durationMs: 100,
      autoFixable: false,
    },
  ],
}));

mock.module("../checks/integrity", () => ({
  runIntegrityChecks: async (): Promise<CheckResult[]> => [
    {
      id: "integrity.stale-locks",
      name: "Lock Files",
      category: "integrity",
      status: "pass",
      message: "No stale locks",
      severity: "info",
      durationMs: 15,
      autoFixable: false,
    },
  ],
}));

describe("CheckEngine", () => {
  describe("runAll", () => {
    it("should run all categories and return a report", async () => {
      const engine = new CheckEngine();
      const report = await engine.runAll();

      expect(report.checks.length).toBe(4);
      expect(report.summary.passed).toBe(4);
      expect(report.summary.failed).toBe(0);
      expect(report.summary.warnings).toBe(0);
      expect(report.durationMs).toBeGreaterThan(0);
      expect(report.timestamp).toBeTruthy();
      expect(report.hostname).toBeTruthy();
    });

    it("should filter by category", async () => {
      const engine = new CheckEngine({ categories: ["runtime"] });
      const report = await engine.runAll();

      expect(report.checks.length).toBe(1);
      expect(report.checks[0].category).toBe("runtime");
    });

    it("should skip checks by ID", async () => {
      const engine = new CheckEngine({ skip: ["runtime.bun-version"] });
      const report = await engine.runAll();

      const bunCheck = report.checks.find((c) => c.id === "runtime.bun-version");
      expect(bunCheck).toBeUndefined();
    });

    it("should handle timeout", async () => {
      // Override with slow check
      mock.module("../checks/runtime", () => ({
        runRuntimeChecks: async (): Promise<CheckResult[]> => {
          await new Promise((r) => setTimeout(r, 5000));
          return [];
        },
      }));

      const engine = new CheckEngine({ timeout: 100, categories: ["runtime"] });
      const report = await engine.runAll();

      expect(report.checks[0].status).toBe("fail");
      expect(report.checks[0].message).toContain("Timeout");
    });
  });

  describe("auto-fix", () => {
    it("should execute fixes when fix option is enabled", async () => {
      let fixCalled = false;

      mock.module("../checks/runtime", () => ({
        runRuntimeChecks: async (): Promise<CheckResult[]> => [
          {
            id: "runtime.test",
            name: "Test",
            category: "runtime",
            status: "warn",
            message: "Needs fix",
            severity: "warning",
            durationMs: 10,
            autoFixable: true,
            fix: async () => {
              fixCalled = true;
              return { success: true, message: "Fixed" };
            },
          },
        ],
      }));

      const engine = new CheckEngine({ fix: true, categories: ["runtime"] });
      const report = await engine.runAll();

      expect(fixCalled).toBe(true);
      expect(report.fixes.length).toBe(1);
      expect(report.fixes[0].success).toBe(true);
      expect(report.summary.fixed).toBe(1);
    });

    it("should not execute fixes when fix option is disabled", async () => {
      let fixCalled = false;

      mock.module("../checks/runtime", () => ({
        runRuntimeChecks: async (): Promise<CheckResult[]> => [
          {
            id: "runtime.test",
            name: "Test",
            category: "runtime",
            status: "warn",
            message: "Needs fix",
            severity: "warning",
            durationMs: 10,
            autoFixable: true,
            fix: async () => {
              fixCalled = true;
              return { success: true, message: "Fixed" };
            },
          },
        ],
      }));

      const engine = new CheckEngine({ fix: false, categories: ["runtime"] });
      await engine.runAll();

      expect(fixCalled).toBe(false);
    });
  });

  describe("buildReport", () => {
    it("should correctly calculate summary statistics", async () => {
      mock.module("../checks/runtime", () => ({
        runRuntimeChecks: async (): Promise<CheckResult[]> => [
          { id: "r1", name: "R1", category: "runtime", status: "pass", message: "", severity: "info", durationMs: 1, autoFixable: false },
          { id: "r2", name: "R2", category: "runtime", status: "warn", message: "", severity: "warning", durationMs: 1, autoFixable: false },
          { id: "r3", name: "R3", category: "runtime", status: "fail", message: "", severity: "error", durationMs: 1, autoFixable: false },
          { id: "r4", name: "R4", category: "runtime", status: "skip", message: "", severity: "info", durationMs: 1, autoFixable: false },
        ],
      }));

      const engine = new CheckEngine({ categories: ["runtime"] });
      const report = await engine.runAll();

      expect(report.summary.passed).toBe(1);
      expect(report.summary.warnings).toBe(1);
      expect(report.summary.failed).toBe(1);
      expect(report.summary.skipped).toBe(1);
      expect(report.summary.total).toBe(4);
    });

    it("should set category status correctly", async () => {
      mock.module("../checks/runtime", () => ({
        runRuntimeChecks: async (): Promise<CheckResult[]> => [
          { id: "r1", name: "R1", category: "runtime", status: "pass", message: "", severity: "info", durationMs: 1, autoFixable: false },
          { id: "r2", name: "R2", category: "runtime", status: "fail", message: "", severity: "error", durationMs: 1, autoFixable: false },
        ],
      }));

      const engine = new CheckEngine({ categories: ["runtime"] });
      const report = await engine.runAll();

      expect(report.categories.runtime.status).toBe("error");
    });
  });
});
