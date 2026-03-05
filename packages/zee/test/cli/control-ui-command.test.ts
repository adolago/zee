import { describe, expect, test } from "bun:test"
import { getControlUiWorkflowProbes } from "../../src/cli/cmd/control-ui"
import { Server } from "../../src/server/server"

describe("control-ui command", () => {
  test("exposes core workflow probes", () => {
    const probes = getControlUiWorkflowProbes()
    const ids = new Set(probes.map((probe) => probe.id))
    expect(ids.has("session_visibility")).toBe(true)
    expect(ids.has("approvals")).toBe(true)
    expect(ids.has("pairing")).toBe(true)
    expect(ids.has("health")).toBe(true)
    expect(ids.has("channel_state")).toBe(true)
  })

  test("core workflow probe paths are present in OpenAPI spec", async () => {
    const app = Server.App()
    const response = await app.request("/openapi")
    expect(response.status).toBe(200)
    const spec = (await response.json()) as { paths?: Record<string, unknown> }
    const paths = spec.paths ?? {}

    for (const probe of getControlUiWorkflowProbes()) {
      expect(paths[probe.path]).toBeDefined()
    }
  })
})
