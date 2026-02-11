import { Provider } from "./provider/provider.js"

export type ProviderRegistry = Record<string, Provider.Info>

/**
 * Exported registry view for external consumers (e.g. gateway stacks).
 *
 * The intent is that agent-core remains the single source of truth for:
 * providers, models, variants, and provider availability filtering.
 */
export async function listProviderRegistry(): Promise<ProviderRegistry> {
  return Provider.list()
}
