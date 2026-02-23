export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function redactUrlForDebugLog(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    return parsed.pathname && parsed.pathname !== "/" ? `${parsed.origin}/...` : parsed.origin
  } catch {
    return "[invalid-url]"
  }
}
