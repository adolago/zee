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

export const personaModels: Record<PersonaId, PersonaModelSpec> = {
  zee:     { providerId: "cerebras",  modelId: "zai-glm-4.7" },
  stanley: { providerId: "xai",       modelId: "grok-4-1-fast" },
  johny:   { providerId: "anthropic", modelId: "claude-opus-4-6" },
};
