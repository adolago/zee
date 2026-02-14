export function normalizeCredentialInput(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lowered = trimmed.toLowerCase();
  if (lowered === "undefined" || lowered === "null") return undefined;
  return trimmed;
}
