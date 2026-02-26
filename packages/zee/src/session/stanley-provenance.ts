import type { MessageV2 } from "./message-v2"

const PROVENANCE_MARKER = "Source Used:"

const VALUATION_PATTERNS: RegExp[] = [
  /\bforward\s*(p\/?e|pe|price[- ]to[- ]earnings)\b/i,
  /\bntm\s*(p\/?e|pe|price[- ]to[- ]earnings)\b/i,
  /\bev\s*\/\s*ebitda\b/i,
  /\bpeg\s*(ratio)?\b/i,
  /\bprice[- ]to[- ]sales\b/i,
  /\bprice[- ]to[- ]book\b/i,
  /\bvaluation\s*(multiple|ratio|metric)\b/i,
]

type ToolStatus = "pending" | "running" | "completed" | "error"

export type ToolTrace = {
  tool: string
  status: ToolStatus
  error?: string
}

export type StanleyProvenanceSummary = {
  primarySource: string
  fallbackUsed: boolean
  fallbackSources: string[]
  fallbackReason: string
  toolCalls: string[]
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase()
}

function isStanleyTool(name: string): boolean {
  return normalizeToolName(name).startsWith("stanley_")
}

function isWebTool(name: string): boolean {
  const normalized = normalizeToolName(name)
  return (
    normalized.includes("websearch") ||
    normalized.includes("web_search") ||
    normalized.includes("webfetch") ||
    normalized.includes("web_fetch") ||
    normalized === "web" ||
    normalized === "openai.web_search" ||
    normalized === "openai.web_search_preview"
  )
}

function unique<T>(items: T[]): T[] {
  const seen = new Set<T>()
  const result: T[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

export function extractTextFromParts(parts: MessageV2.Part[]): string {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export function isValuationMetricQuery(query: string): boolean {
  if (!query.trim()) return false
  return VALUATION_PATTERNS.some((pattern) => pattern.test(query))
}

export function summarizeStanleyProvenance(toolTraces: ToolTrace[]): StanleyProvenanceSummary | null {
  if (toolTraces.length === 0) return null

  const orderedToolCalls = unique(toolTraces.map((trace) => trace.tool))
  const completedStanley = toolTraces.filter((trace) => isStanleyTool(trace.tool) && trace.status === "completed")
  const errorStanley = toolTraces.filter((trace) => isStanleyTool(trace.tool) && trace.status === "error")
  const completedWeb = toolTraces.filter((trace) => isWebTool(trace.tool) && trace.status === "completed")

  const primaryStanley =
    completedStanley.find((trace) => normalizeToolName(trace.tool) === "stanley_research")?.tool ??
    completedStanley[0]?.tool
  const primaryWeb = completedWeb[0]?.tool
  const primarySource = primaryStanley ?? primaryWeb ?? orderedToolCalls[0]
  if (!primarySource) return null

  const fallbackSources = unique(completedWeb.map((trace) => trace.tool))
  const fallbackUsed = fallbackSources.length > 0

  let fallbackReason = "No fallback used."
  if (fallbackUsed) {
    if (primaryStanley) {
      fallbackReason =
        errorStanley.length > 0
          ? "Stanley returned partial/failed outputs; web fallback was used."
          : "Web fallback was used for secondary corroboration."
    } else {
      fallbackReason =
        errorStanley.length > 0
          ? "Stanley failed in this turn; web fallback was used."
          : "Stanley did not return a completed result in this turn; web fallback was used."
    }
  }

  return {
    primarySource,
    fallbackUsed,
    fallbackSources,
    fallbackReason,
    toolCalls: orderedToolCalls,
  }
}

export function formatStanleyProvenanceBlock(summary: StanleyProvenanceSummary): string {
  const fallbackLabel = summary.fallbackUsed ? "yes" : "no"
  const fallbackSources = summary.fallbackSources.length > 0 ? summary.fallbackSources.join(", ") : "none"
  const toolCalls = summary.toolCalls.join(", ")

  return [
    "Source Used:",
    `- Primary source: ${summary.primarySource}`,
    `- Fallback used: ${fallbackLabel}`,
    `- Fallback source(s): ${fallbackSources}`,
    `- Fallback reason: ${summary.fallbackReason}`,
    `- Tool calls used: ${toolCalls}`,
  ].join("\n")
}

export function appendStanleyProvenance(text: string, summary: StanleyProvenanceSummary): string {
  const normalized = text.trimEnd()
  if (normalized.includes(PROVENANCE_MARKER)) return normalized
  return `${normalized}\n\n${formatStanleyProvenanceBlock(summary)}`
}
