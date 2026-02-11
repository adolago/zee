import { describe, expect, test, afterAll } from "bun:test"
import { Provider } from "../../src/provider/provider"
import { Server } from "../../src/server/server"

const originalReload = Provider.reload
Provider.reload = async () => {
  throw new Error("Simulated unexpected error")
}

afterAll(() => {
  Provider.reload = originalReload
})

describe("Error handling", () => {
  test("Does not leak stack trace on 500 error", async () => {
    const app = Server.App()

    // We use a PUT to /auth/test-provider which calls Provider.reload()
    const response = await app.request("/auth/test-provider", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "api",
        key: "test",
      }),
    })

    expect(response.status).toBe(500)
    const body = await response.json()
    console.log("DEBUG RESPONSE BODY:", JSON.stringify(body, null, 2))

    // The current implementation wraps the error in NamedError.Unknown
    // which has structure { name: "UnknownError", data: { message: ... } }
    expect(body.name).toBe("UnknownError")
    expect(body.data).toBeDefined()
    expect(body.data.message).toBeDefined()

    // Verify it contains the message
    expect(body.data.message).toContain("Simulated unexpected error")
    // Verify it DOES NOT contain stack trace info (stack traces usually contain "at " and file paths)
    expect(body.data.message).not.toContain("at ")
    expect(body.data.message).not.toContain("error-leak.test.ts")
  })
})
