import { describe, expect, test, afterAll } from "bun:test"
import { Auth } from "../../src/auth"
import { Provider } from "../../src/provider/provider"

const originalReload = Provider.reload
const originalValidateAuth = Provider.validateAuth
Provider.reload = async () => {}
Provider.validateAuth = async () => {}
afterAll(() => {
  Provider.reload = originalReload
  Provider.validateAuth = originalValidateAuth
})

const { AuthRoute } = await import("../../src/server/route/auth")

describe("auth.set endpoint", () => {
  test("accepts Auth.Info payload and updates credentials at runtime", async () => {
    const response = await AuthRoute.request("/openrouter", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "api",
        key: "test-key",
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)

    const stored = await Auth.get("openrouter")
    expect(stored?.type).toBe("api")
    expect(stored && "key" in stored ? stored.key : undefined).toBe("test-key")
  })

  test("accepts legacy api_key payload", async () => {
    const response = await AuthRoute.request("/openrouter", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: "legacy-key",
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)

    const stored = await Auth.get("openrouter")
    expect(stored?.type).toBe("api")
    expect(stored && "key" in stored ? stored.key : undefined).toBe("legacy-key")
  })
})
