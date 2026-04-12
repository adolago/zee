import { describe, expect, test } from "bun:test"
import { resolveDefaultModel, type ProviderCatalog } from "../../src/provider/model-selection"

const providers: ProviderCatalog[] = [
  {
    id: "openai",
    models: {
      "gpt-5.4": { id: "gpt-5.4" },
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
      configured: { providerID: "openai", modelID: "gpt-5.4" },
      rosetta: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      providers,
      sortModels: (models) => models,
    })

    expect(result).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
  })

  test("falls back to sorted best model when configured/rosetta are unavailable", async () => {
    const result = await resolveDefaultModel({
      configured: { providerID: "outside-core", modelID: "qwen3-coder" },
      rosetta: { providerID: "xai", modelID: "grok-4.20-experimental-beta-0304-reasoning" },
      providers,
      sortModels: (models) => [...models].sort((a, b) => `${a.providerID}/${a.id}`.localeCompare(`${b.providerID}/${b.id}`)),
    })

    expect(result).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
  })
})
