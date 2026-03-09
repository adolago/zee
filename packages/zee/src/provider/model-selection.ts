import { Log } from "@/util/log"

export type ModelReference = {
  providerID: string
  modelID: string
}

type CatalogModel = {
  id: string
}

export type ProviderCatalog = {
  id: string
  models: Record<string, CatalogModel>
}

type SortableModel = {
  id: string
  providerID: string
}

const log = Log.create({ service: "provider:model-selection" })
let rosettaDefaultModelCache: ModelReference | null | undefined

function hasModel(providers: ProviderCatalog[], target: ModelReference): boolean {
  const provider = providers.find((p) => p.id === target.providerID)
  if (!provider) return false
  return !!provider.models[target.modelID]
}

/**
 * Load global model rosetta default from src/agent/model-rosetta.
 * Caches result after first read.
 */
export async function loadRosettaDefaultModel(): Promise<ModelReference | undefined> {
  if (rosettaDefaultModelCache !== undefined) {
    return rosettaDefaultModelCache ?? undefined
  }

  try {
    const mod = await import("../../../../src/agent/model-rosetta")
    const candidate = (mod as any).standardModel ?? (mod as any).assistantModels?.zee
    if (
      candidate &&
      typeof candidate.providerId === "string" &&
      candidate.providerId.length > 0 &&
      typeof candidate.modelId === "string" &&
      candidate.modelId.length > 0
    ) {
      rosettaDefaultModelCache = {
        providerID: candidate.providerId,
        modelID: candidate.modelId,
      }
      return rosettaDefaultModelCache
    }
  } catch (error) {
    log.debug("failed to load model rosetta default", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  rosettaDefaultModelCache = null
  return undefined
}

/**
 * Resolve default model with consistent precedence:
 * explicit > configured > rosetta > best available model from provider catalog.
 */
export async function resolveDefaultModel(input: {
  explicit?: ModelReference
  configured?: ModelReference
  rosetta?: ModelReference
  providers: ProviderCatalog[]
  sortModels: (models: SortableModel[]) => SortableModel[]
  isModelAvailable?: (target: ModelReference) => boolean | Promise<boolean>
}): Promise<ModelReference | undefined> {
  const availability = async (target: ModelReference): Promise<boolean> => {
    if (input.providers.length === 0) return true
    if (input.isModelAvailable) return !!(await input.isModelAvailable(target))
    return hasModel(input.providers, target)
  }

  const ordered = [input.explicit, input.configured, input.rosetta].filter(Boolean) as ModelReference[]
  for (const candidate of ordered) {
    if (await availability(candidate)) {
      return candidate
    }
  }

  const allModels = input.providers.flatMap((provider) =>
    Object.values(provider.models).map((model) => ({
      id: model.id,
      providerID: provider.id,
    })),
  )
  if (allModels.length === 0) {
    return undefined
  }

  const [best] = input.sortModels(allModels)
  if (!best) return undefined

  return {
    providerID: best.providerID,
    modelID: best.id,
  }
}
