/**
 * Persona Model Rosetta
 *
 * SINGLE SOURCE OF TRUTH for persona default models.
 * Import from here, not from scattered config files.
 *
 * Format follows the existing Rosetta Stone pattern (see src/theme/rosetta.ts).
 */

import type { PersonaId } from "../theme/rosetta";

export interface PersonaModelSpec {
  providerId: string;
  modelId: string;
}

/** Canonical provider/model string (e.g. "anthropic/claude-opus-4-6") */
export function modelString(spec: PersonaModelSpec): string {
  return `${spec.providerId}/${spec.modelId}`;
}

/**
 * Global standard model for Zee runtime defaults.
 * Keep this in sync with provider allowlist/model catalog.
 */
export const standardModel: PersonaModelSpec = {
  providerId: "openai",
  modelId: "gpt-5.4",
};

export const personaModels: Record<PersonaId, PersonaModelSpec> = {
  zee: standardModel,
  stanley: { providerId: "xai",       modelId: "grok-4.20-experimental-beta-0304-reasoning" },
  johny:   { providerId: "anthropic", modelId: "claude-opus-4-6" },
};
