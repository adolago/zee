import { describe, expect, test, afterAll } from "bun:test"
import { Auth } from "../../src/auth"
import { reloadFlags } from "../../src/flag/flag"
import { Provider } from "../../src/provider/provider"

const originalEnvNoNewLegacy = process.env.ZEE_NO_NEW_LEGACY
const originalReload = Provider.reload
const originalValidateAuth = Provider.validateAuth
Provider.reload = async () => {}
Provider.validateAuth = async () => {}
afterAll(() => {
  Provider.reload = originalReload
  Provider.validateAuth = originalValidateAuth
  if (originalEnvNoNewLegacy === undefined) {
    delete process.env.ZEE_NO_NEW_LEGACY
  } else {
    process.env.ZEE_NO_NEW_LEGACY = originalEnvNoNewLegacy
  }
  reloadFlags()
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

  test("blocks legacy api_key payload when no-new-legacy flag is enabled", async () => {
    try {
      process.env.ZEE_NO_NEW_LEGACY = "1"
      reloadFlags()
      const response = await AuthRoute.request("/openrouter", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: "legacy-key",
        }),
      })

      expect(response.status).toBe(403)
      const body = (await response.json()) as { error?: string }
      expect(body.error).toBe("Legacy auth payloads are disabled. Use the modern auth payload schema.")
    } finally {
      if (originalEnvNoNewLegacy === undefined) {
        delete process.env.ZEE_NO_NEW_LEGACY
      } else {
        process.env.ZEE_NO_NEW_LEGACY = originalEnvNoNewLegacy
      }
      reloadFlags()
    }
  })
})
