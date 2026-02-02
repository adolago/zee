/**
 * Token estimation utilities.
 *
 * Simple character-based estimators for pre-request breakdown.
 * Anthropic API returns exact counts; these are used to attribute
 * the total across context components.
 */

/**
 * Estimate token count for natural-language text.
 * Uses ~4 chars/token heuristic for English prose.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Estimate token count for a JSON schema object.
 * JSON is more token-dense (~3.5 chars/token) due to
 * structural characters, short keys, and enum values.
 */
export function estimateJsonSchemaTokens(schema: unknown): number {
  const json = JSON.stringify(schema)
  if (!json) return 0
  return Math.ceil(json.length / 3.5)
}

/**
 * Estimate token count for a tool definition (description + JSON schema).
 * Accounts for the tool wrapper overhead added by the API.
 */
export function estimateToolTokens(tool: { description?: string; parameters?: unknown }): number {
  const descTokens = estimateTokens(tool.description ?? "")
  const schemaTokens = estimateJsonSchemaTokens(tool.parameters ?? {})
  // API adds ~20 tokens of wrapper per tool (name, type envelope)
  return descTokens + schemaTokens + 20
}
