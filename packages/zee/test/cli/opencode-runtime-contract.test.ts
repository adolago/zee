import { describe, expect, test } from "bun:test"
import {
  buildOpenCodeRuntimeInventoryReport,
  renderOpenCodeRuntimeInventoryMarkdown,
} from "../../src/runtime/opencode-contract"

describe("OpenCode runtime contract report", () => {
  test("buildOpenCodeRuntimeInventoryReport inventories the three runtime surfaces", () => {
    const report = buildOpenCodeRuntimeInventoryReport(new Date("2026-03-14T10:00:00.000Z"))

    expect(report.contractVersion).toBe("opencode-runtime-v1")
    expect(report.metrics.surfaceCount).toBe(3)
    expect(report.metrics.entrypointCount).toBeGreaterThanOrEqual(12)
    expect(report.metrics.requiredOperationCount).toBeGreaterThanOrEqual(13)
    expect(report.metrics.telemetrySourceCount).toBeGreaterThanOrEqual(6)
    expect(report.metrics.flowCountByParityStrategy.adapt).toBe(3)

    expect(report.flows.map((flow) => flow.surface)).toEqual(["cli", "orchestration", "gateway"])
    expect(report.flows[0]?.entrypoints.map((entrypoint) => entrypoint.id)).toContain("cli.run")
    expect(report.flows[1]?.entrypoints.map((entrypoint) => entrypoint.id)).toContain("orchestration.daemon_ipc_server")
    expect(report.flows[2]?.entrypoints.map((entrypoint) => entrypoint.id)).toContain("gateway.http_route")
  })

  test("renderOpenCodeRuntimeInventoryMarkdown prints the key inventory sections", () => {
    const report = buildOpenCodeRuntimeInventoryReport(new Date("2026-03-14T10:00:00.000Z"))
    const markdown = renderOpenCodeRuntimeInventoryMarkdown(report)

    expect(markdown).toContain("# OpenCode Runtime Inventory")
    expect(markdown).toContain("## CLI Flow")
    expect(markdown).toContain("## Orchestration Flow")
    expect(markdown).toContain("## Gateway Flow")
    expect(markdown).toContain("packages/zee/src/index.ts")
    expect(markdown).toContain("FluxRecorder.record()")
  })
})
