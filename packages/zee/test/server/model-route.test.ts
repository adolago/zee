import { afterAll, describe, expect, test } from "bun:test"
import { ModelsDev } from "../../src/provider/models"
import { Provider } from "../../src/provider/provider"
import { ProviderAuth } from "../../src/provider/auth"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"

const originalModelsGet = ModelsDev.get
const originalModelsRefresh = ModelsDev.refresh
const originalProviderList = Provider.list
const originalAuthMethods = ProviderAuth.methods

ModelsDev.get = async () => ({
  "test-service": {
    id: "test-service",
    name: "Test Service",
    env: [],
    models: {},
  },
  google: {
    id: "google",
    name: "Google AI",
    env: [],
    models: {},
  },
  nebius: {
    id: "nebius",
    name: "Nebius",
    env: [],
    models: {},
  },
})
ModelsDev.refresh = async () => {}
Provider.list = async () => ({})
ProviderAuth.methods = async () => ({})

afterAll(() => {
  ModelsDev.get = originalModelsGet
  ModelsDev.refresh = originalModelsRefresh
  Provider.list = originalProviderList
  ProviderAuth.methods = originalAuthMethods
})

const { ModelRoute } = await import("../../src/server/route/model")
const testDirectory = process.cwd()

describe("model route", () => {
  test("skips defaults for providers without models", async () => {
    await Instance.provide({
      directory: testDirectory,
      fn: async () => {
        const response = await ModelRoute.request("/provider")
        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.default["test-service"]).toBeUndefined()
      },
    })
  })

  test("filters blocked providers from provider list", async () => {
    await Instance.provide({
      directory: testDirectory,
      fn: async () => {
        const response = await ModelRoute.request("/provider")
        expect(response.status).toBe(200)
        const data = await response.json()
        const ids = (data.all as Array<{ id: string }>).map((provider) => provider.id)
        expect(ids).not.toContain("nebius")
        expect(ids).not.toContain("google")
      },
    })
  })

  test("auth-only provider appears in list after credential is set", async () => {
    const original = ProviderAuth.methods
    ProviderAuth.methods = async () => ({
      kernel: [
        {
          type: "oauth",
          label: "OAuth",
        },
      ],
    })
    try {
      await Auth.set("kernel", {
        type: "api",
        key: "test-key",
      })
      await Instance.provide({
        directory: testDirectory,
        fn: async () => {
          const response = await ModelRoute.request("/provider")
          expect(response.status).toBe(200)
          const data = await response.json()
          const ids = (data.all as Array<{ id: string }>).map((provider) => provider.id)
          expect(ids).toContain("kernel")
          expect(data.connected).toContain("kernel")
          const entry = (data.all as Array<{ id: string; name?: string }>).find((provider) => provider.id === "kernel")
          expect(entry?.name).toBe("Kernel")
        },
      })
    } finally {
      ProviderAuth.methods = original
      await Auth.remove("kernel")
    }
  })

  test("provider auth endpoints hide removed Google chat providers", async () => {
    const original = ProviderAuth.methods
    ProviderAuth.methods = async () => ({
      "gemini-cli": [{ type: "oauth", label: "OAuth" }],
      "google-antigravity": [{ type: "oauth", label: "OAuth" }],
      kernel: [{ type: "oauth", label: "OAuth" }],
    })

    try {
      await Auth.set("gemini-cli", { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 60_000 })
      await Auth.set("google-antigravity", { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 60_000 })
      await Auth.set("kernel", { type: "api", key: "test-key" })

      await Instance.provide({
        directory: testDirectory,
        fn: async () => {
          const authResponse = await ModelRoute.request("/provider/auth")
          expect(authResponse.status).toBe(200)
          const authMethods = (await authResponse.json()) as Record<string, unknown>
          expect(authMethods["gemini-cli"]).toBeUndefined()
          expect(authMethods["google-antigravity"]).toBeUndefined()
          expect(authMethods.kernel).toBeDefined()

          const statusResponse = await ModelRoute.request("/provider/auth/status")
          expect(statusResponse.status).toBe(200)
          const status = (await statusResponse.json()) as Record<string, unknown>
          expect(status["gemini-cli"]).toBeUndefined()
          expect(status["google-antigravity"]).toBeUndefined()
          expect(status.kernel).toBeDefined()
        },
      })
    } finally {
      ProviderAuth.methods = original
      await Auth.remove("gemini-cli")
      await Auth.remove("google-antigravity")
      await Auth.remove("kernel")
    }
  })
})
