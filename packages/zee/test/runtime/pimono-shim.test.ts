import { describe, expect, test } from "bun:test"
import { recordPiMonoShimUsage } from "../../src/runtime/pimono-shim"

describe("pi-mono shim usage warnings", () => {
  test("resolves the registered boundary", () => {
    const boundary = recordPiMonoShimUsage({
      boundaryID: "server.llm.pi-ai-bridge",
    })

    expect(boundary.id).toBe("server.llm.pi-ai-bridge")
    expect(boundary.status).toBe("active_temporary")
  })
})
