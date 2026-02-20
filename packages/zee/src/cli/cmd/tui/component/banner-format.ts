export type BannerKind = "reminder" | "todo" | "message"

export function displayWidth(text: string): number {
  return Bun.stringWidth(text)
}

export function sanitizeOneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function cutToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  let out = ""
  for (const ch of text) {
    const next = out + ch
    if (displayWidth(next) > maxWidth) break
    out = next
  }
  return out
}

export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (displayWidth(text) <= maxWidth) return text
  if (maxWidth <= 3) return cutToWidth(text, maxWidth)
  return cutToWidth(text, maxWidth - 3) + "..."
}

const LEGACY_SESSION_SUFFIX = /\s*\(session:\s*[^)]+\)\s*$/i

function kindLegacyPrefix(kind: BannerKind): RegExp {
  switch (kind) {
    case "todo":
      return /^\s*\[\s*TODO\s*\]\s*/i
    case "reminder":
      return /^\s*\[\s*REM\s*\]\s*/i
    case "message":
      return /^\s*\[\s*MSG\s*\]\s*/i
  }
}

export function sanitizeLegacyBannerText(kind: BannerKind, text: string): string {
  const oneLine = sanitizeOneLine(text)
  const withoutPrefix = oneLine.replace(kindLegacyPrefix(kind), "")
  const withoutSuffix = withoutPrefix.replace(LEGACY_SESSION_SUFFIX, "").trim()

  if (kind === "todo") {
    const legacySummary = /^Todos:\s*(\d+)\s+open$/i.exec(withoutSuffix)
    if (legacySummary) {
      const openCount = Number.parseInt(legacySummary[1] ?? "0", 10)
      return `${openCount} open ${openCount === 1 ? "task" : "tasks"}`
    }
  }

  return withoutSuffix
}
