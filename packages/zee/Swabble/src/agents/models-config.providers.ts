import type { ZeeConfig } from "../config/config.js";

type ModelsConfig = NonNullable<ZeeConfig["models"]>;
export type ProviderConfig = NonNullable<ModelsConfig["providers"]>[string];

/**
 * Normalizations needed for compatibility with provider-side renames.
 *
 * Keep this exported; multiple subsystems import it (model selection, media pipelines).
 */
export function normalizeGoogleModelId(id: string): string {
  if (id === "gemini-3-pro") return "gemini-3-pro-preview";
  if (id === "gemini-3-flash") return "gemini-3-flash-preview";
  return id;
}

