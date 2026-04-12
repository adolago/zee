function normalizeError(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object") {
    const anyErr = error as any
    if (typeof anyErr?.message === "string") return anyErr.message
    if (typeof anyErr?.error?.message === "string") return anyErr.error.message
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function extractBunFallbackError(text: string): string | undefined {
  if (!/<html[\s>]/i.test(text) || !text.includes("__bunfallback")) return undefined

  const script = text.match(/<script[^>]+id=["']__bunfallback["'][^>]*>\s*([A-Za-z0-9+/=\s]+)\s*<\/script>/i)
  const encoded = script?.[1]?.replace(/\s+/g, "")
  if (!encoded) return "Bun runtime error returned an HTML fallback response. Check Zee logs for details."

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8")
    const printable = decoded
      .replace(/[^\x20-\x7e]+/g, "\n")
      .split("\n")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)

    const message =
      printable.find((part) => part.startsWith("Cannot find module ")) ??
      printable.find((part) => part.includes("Exception") || part.includes("Error")) ??
      printable.find((part) => part.length > 12)

    if (message) return `Bun runtime error: ${message}`
  } catch {
    // Fall through to the generic message.
  }

  return "Bun runtime error returned an HTML fallback response. Check Zee logs for details."
}

export function formatSubmitError(error: unknown): string {
  const normalized = normalizeError(error)
  const bunFallback = extractBunFallbackError(normalized)
  if (bunFallback) return bunFallback

  const collapsed = normalized.replace(/\s+/g, " ").trim()
  return collapsed || "Unknown error"
}
