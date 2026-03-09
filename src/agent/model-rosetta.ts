/**
 * Assistant Model Rosetta
 *
 * SINGLE SOURCE OF TRUTH for default assistant models.
 * Import from here, not from scattered config files.
 *
 * Format follows the existing Rosetta Stone pattern (see src/theme/rosetta.ts).
 */

import type { AssistantId } from "../theme/rosetta";

export interface AssistantModelSpec {
  providerId: string;
  modelId: string;
}

/** Canonical provider/model string (e.g. "anthropic/claude-opus-4-6") */
export function modelString(spec: AssistantModelSpec): string {
  return `${spec.providerId}/${spec.modelId}`;
}

/**
 * Global standard model for Zee runtime defaults.
 * Keep this in sync with provider allowlist/model catalog.
 */
export const standardModel: AssistantModelSpec = {
  providerId: "openai",
  modelId: "gpt-5.4",
};

export const assistantModels: Record<AssistantId, AssistantModelSpec> = {
  zee: standardModel,
};
