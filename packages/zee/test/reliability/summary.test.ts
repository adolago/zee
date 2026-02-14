import { describe, expect, test } from "bun:test"
import { formatReliabilitySummary } from "../../src/reliability/runner"
import type { ReliabilityReportV1 } from "../../src/reliability/types"

describe("reliability summary formatter", () => {
  test("renders compact stage status output", () => {
    const report: ReliabilityReportV1 = {
      version: "1",
      generatedAt: new Date().toISOString(),
      profile: "diag",
      repoRoot: "/tmp/repo",
      artifactDir: "/tmp/repo/artifacts/reliability/test",
      platform: "linux",
      summary: {
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
      },
      stages: [
        {
          id: "R01",
          name: "Build",
          description: "build",
          required: true,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 1200,
          status: "pass",
          summary: "ok",
          details: [],
          artifacts: [],
          metrics: {},
        },
        {
          id: "R02",
          name: "Parity",
          description: "parity",
          required: true,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 2000,
          status: "fail",
          summary: "failed",
          details: ["boom"],
          artifacts: [],
          metrics: {},
          error: "boom",
        },
      ],
      assumptions: [],
    }

    const output = formatReliabilitySummary(report)
    expect(output).toContain("Reliability profile: diag")
    expect(output).toContain("[PASS] R01")
    expect(output).toContain("[FAIL] R02")
    expect(output).toContain("error: boom")
  })
})
