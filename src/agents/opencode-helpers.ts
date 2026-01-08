/**
 * Helper functions for messaging and text processing.
 * Migrated from pi-embedded-helpers.ts without pi-* dependencies.
 */

const MIN_DUPLICATE_TEXT_LENGTH = 10;

/**
 * Context file for embedding in agent sessions.
 */
export type EmbeddedContextFile = {
  path: string;
  content: string;
  tokens?: number;
};

/**
 * Normalize text for comparison:
 * - Trims
 * - Lowercases
 * - Strips emoji (Emoji_Presentation and Extended_Pictographic)
 * - Collapses multiple spaces to single space
 */
export function normalizeTextForComparison(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if a text is a duplicate of any previously sent messaging tool text.
 * Uses substring matching to handle LLM elaboration (e.g., wrapping in quotes,
 * adding context, or slight rephrasing that includes the original).
 */
export function isMessagingToolDuplicate(
  text: string,
  sentTexts: string[],
): boolean {
  if (sentTexts.length === 0) return false;
  const normalized = normalizeTextForComparison(text);
  if (!normalized || normalized.length < MIN_DUPLICATE_TEXT_LENGTH)
    return false;
  return sentTexts.some((sent) => {
    const normalizedSent = normalizeTextForComparison(sent);
    if (!normalizedSent || normalizedSent.length < MIN_DUPLICATE_TEXT_LENGTH)
      return false;
    // Substring match: either text contains the other
    return (
      normalized.includes(normalizedSent) || normalizedSent.includes(normalized)
    );
  });
}
