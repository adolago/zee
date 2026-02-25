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
      },
    })
  })

  test("auth-only provider appears in list after credential is set", async () => {
    const original = ProviderAuth.methods
    ProviderAuth.methods = async () => ({
      "gemini-cli": [
        {
          type: "oauth",
          label: "OAuth",
        },
      ],
    })
    try {
      await Auth.set("gemini-cli", {
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
          expect(ids).toContain("gemini-cli")
          expect(data.connected).toContain("gemini-cli")
          const entry = (data.all as Array<{ id: string; name?: string }>).find((provider) => provider.id === "gemini-cli")
          expect(entry?.name).toBe("Gemini CLI")
        },
      })
    } finally {
      ProviderAuth.methods = original
      await Auth.remove("gemini-cli")
    }
  })
})
