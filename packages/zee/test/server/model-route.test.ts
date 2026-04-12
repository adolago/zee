import { afterAll, describe, expect, test } from "bun:test"
import { ModelsDev } from "../../src/provider/models"
import { Provider } from "../../src/provider/provider"
import { ProviderAuth } from "../../src/provider/auth"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"
import { tmpdir } from "../fixture/fixture"

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
  "legacy-service": {
    id: "legacy-service",
    name: "Legacy Service",
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

describe("model route", () => {
  test("skips defaults for providers without models", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await ModelRoute.request("/provider")
        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.default["test-service"]).toBeUndefined()
      },
    })
  })

  test("filters non-core providers from provider list", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await ModelRoute.request("/provider")
        expect(response.status).toBe(200)
        const data = await response.json()
        const ids = (data.all as Array<{ id: string }>).map((provider) => provider.id)
        expect(ids).not.toContain("legacy-service")
        expect(ids).toContain("google")
      },
    })
  })

  test("auth-only provider appears in list after credential is set", async () => {
    const original = ProviderAuth.methods
    ProviderAuth.methods = async () => ({
      languagetool: [
        {
          type: "api",
          label: "API key",
        },
      ],
    })
    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Auth.set("languagetool", {
            type: "api",
            key: "test-key",
          })
          const response = await ModelRoute.request("/provider")
          expect(response.status).toBe(200)
          const data = await response.json()
          const ids = (data.all as Array<{ id: string }>).map((provider) => provider.id)
          expect(ids).toContain("languagetool")
          expect(data.connected).toContain("languagetool")
          const entry = (data.all as Array<{ id: string; name?: string }>).find(
            (provider) => provider.id === "languagetool",
          )
          expect(entry?.name).toBe("LanguageTool")
        },
      })
    } finally {
      ProviderAuth.methods = original
      await Auth.remove("languagetool")
    }
  })

  test("provider auth endpoints keep Antigravity auth and hide Gemini CLI", async () => {
    const original = ProviderAuth.methods
    ProviderAuth.methods = async () => ({
      "gemini-cli": [{ type: "oauth", label: "OAuth" }],
      "google-antigravity": [{ type: "oauth", label: "OAuth" }],
    })

    try {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Auth.set("gemini-cli", { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 60_000 })
          await Auth.set("google-antigravity", {
            type: "oauth",
            access: "a",
            refresh: "r",
            expires: Date.now() + 60_000,
          })
          const authResponse = await ModelRoute.request("/provider/auth")
          expect(authResponse.status).toBe(200)
          const authMethods = (await authResponse.json()) as Record<string, unknown>
          expect(authMethods["gemini-cli"]).toBeUndefined()
          expect(authMethods["google-antigravity"]).toBeDefined()

          const statusResponse = await ModelRoute.request("/provider/auth/status")
          expect(statusResponse.status).toBe(200)
          const status = (await statusResponse.json()) as Record<string, unknown>
          expect(status["gemini-cli"]).toBeUndefined()
          expect(status["google-antigravity"]).toBeDefined()
        },
      })
    } finally {
      ProviderAuth.methods = original
      await Auth.remove("gemini-cli")
      await Auth.remove("google-antigravity")
    }
  })
})
