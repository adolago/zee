import { describe, expect, test } from "bun:test"
import { resolveDefaultModel, type ProviderCatalog } from "../../src/provider/model-selection"

const providers: ProviderCatalog[] = [
  {
    id: "openai",
    models: {
      "gpt-5.2": { id: "gpt-5.2" },
      "gpt-5.3-codex": { id: "gpt-5.3-codex" },
    },
  },
  {
    id: "anthropic",
    models: {
      "claude-opus-4-6": { id: "claude-opus-4-6" },
    },
  },
]

describe("model selection", () => {
  test("prefers configured model when available", async () => {
    const result = await resolveDefaultModel({
      configured: { providerID: "openai", modelID: "gpt-5.2" },
      rosetta: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      providers,
      sortModels: (models) => models,
    })

    expect(result).toEqual({ providerID: "openai", modelID: "gpt-5.2" })
  })

  test("falls back to sorted best model when configured/rosetta are unavailable", async () => {
    const result = await resolveDefaultModel({
      configured: { providerID: "google", modelID: "gemini-3-pro-preview" },
      rosetta: { providerID: "xai", modelID: "grok-4-1-fast" },
      providers,
      sortModels: (models) => [...models].sort((a, b) => `${a.providerID}/${a.id}`.localeCompare(`${b.providerID}/${b.id}`)),
    })

    expect(result).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
  })
})
