import { describe, expect, test } from "bun:test"
import { FluxRecorder } from "../../src/flux"
import { recordPiMonoShimUsage } from "../../src/runtime/pimono-shim"

describe("pi-mono shim usage telemetry", () => {
  test("records compat.shim.used once per boundary dedupe key", () => {
    const before = FluxRecorder.list({ kind: "compat.shim.used" }).total

    recordPiMonoShimUsage({
      boundaryID: "server.llm.pi-ai-bridge",
      traceID: "trace-a",
      dedupeKey: "request-a",
    })
    recordPiMonoShimUsage({
      boundaryID: "server.llm.pi-ai-bridge",
      traceID: "trace-a",
      dedupeKey: "request-a",
    })
    recordPiMonoShimUsage({
      boundaryID: "server.llm.pi-ai-bridge",
      traceID: "trace-b",
      dedupeKey: "request-b",
    })

    const after = FluxRecorder.list({ kind: "compat.shim.used" })
    expect(after.total).toBe(before + 2)
    const latest = after.events.slice(-2)
    expect(latest.every((event) => event.metadata?.boundaryID === "server.llm.pi-ai-bridge")).toBe(true)
  })
})
