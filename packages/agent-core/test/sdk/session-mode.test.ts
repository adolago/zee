import { describe, expect, test } from "bun:test"
import { AgentCoreClient } from "../../src/pkg/sdk/v2/client"

describe("SDK v2 session.mode", () => {
  test("calls client.patch with correct payload", async () => {
    const calls: any[] = []
    const stubClient = {
      patch: async (req: any) => {
        calls.push(req)
        return { data: { ok: true, mode: "release" } }
      },
    }
    const sdk = new AgentCoreClient({ client: stubClient as any })

    await sdk.session.mode(
      { sessionID: "ses_test", mode: "release", directory: "/tmp" } as any,
      { throwOnError: true, headers: { "x-test": "1" } } as any,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("/session/ses_test/mode")
    expect(calls[0]?.body).toEqual({ mode: "release" })
    expect(calls[0]?.headers?.["Content-Type"]).toBe("application/json")
    expect(calls[0]?.headers?.["x-test"]).toBe("1")
    expect(calls[0]?.throwOnError).toBe(true)
  })
})
