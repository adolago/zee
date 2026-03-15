import { FluxRecorder } from "@/flux"
import {
  listInvestingEvents,
  type InvestingEventAudience,
  type InvestingEventClassification,
  type InvestingEventDirection,
  type InvestingEventMaterialityBand,
  type InvestingEventRecord,
} from "./events"

export const INVESTING_EVENT_DELTA_MODES = ["daily", "pre-earnings", "post-earnings"] as const

export type InvestingEventDeltaMode = (typeof INVESTING_EVENT_DELTA_MODES)[number]

export interface InvestingEventDeltaItem {
  id: string
  eventId: string
  symbol?: string
  asOf: string
  headline: string
  delta: string
  classification: InvestingEventClassification
  direction: InvestingEventDirection
  materialityBand: InvestingEventMaterialityBand
  materialityScore: number
  audience: InvestingEventAudience
  sectors: string[]
  implications: string[]
}

export interface InvestingEventDeltaBrief {
  id: string
  mode: InvestingEventDeltaMode
  generatedAt: string
  symbols: string[]
  summary: string
  items: InvestingEventDeltaItem[]
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}

function normalizeSymbols(symbols?: string[]): string[] {
  return [...new Set((symbols ?? []).map(normalizeSymbol).filter((symbol) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)))]
}

function bandRank(band: InvestingEventMaterialityBand): number {
  switch (band) {
    case "critical":
      return 3
    case "high":
      return 2
    case "medium":
      return 1
    case "low":
    default:
      return 0
  }
}

function minimumBandForMode(mode: InvestingEventDeltaMode): InvestingEventMaterialityBand {
  switch (mode) {
    case "pre-earnings":
      return "medium"
    case "post-earnings":
    case "daily":
    default:
      return "high"
  }
}

function modeWeight(mode: InvestingEventDeltaMode, event: InvestingEventRecord): number {
  switch (mode) {
    case "pre-earnings":
      if (event.classification === "guidance_update") return 24
      if (event.classification === "earnings_result") return 18
      if (event.classification === "legal_regulatory") return 12
      if (event.classification === "product_and_partnership") return 10
      return 0
    case "post-earnings":
      if (event.classification === "earnings_result") return 24
      if (event.classification === "guidance_update") return 18
      if (event.classification === "legal_regulatory") return 10
      return 0
    case "daily":
    default:
      if (event.entityLinks.audience === "holding") return 18
      if (event.entityLinks.audience === "watchlist") return 10
      return 0
  }
}

function dedupeEvents(events: InvestingEventRecord[]): InvestingEventRecord[] {
  const byId = new Map<string, InvestingEventRecord>()
  for (const event of events) {
    byId.set(event.id, event)
  }
  return [...byId.values()]
}

function classificationLabel(classification: InvestingEventClassification): string {
  return classification.replace(/_/g, " ")
}

function audienceLabel(audience: InvestingEventAudience): string {
  switch (audience) {
    case "holding":
      return "holding"
    case "watchlist":
      return "watchlist"
    case "general":
    default:
      return "general coverage"
  }
}

function implicationsForEvent(event: InvestingEventRecord, mode: InvestingEventDeltaMode): string[] {
  const symbol = event.symbol ?? "this name"
  const actions: string[] = []

  if (mode === "daily") {
    if (event.entityLinks.audience === "holding") {
      actions.push(`Review ${symbol} position sizing and today's risk watchpoints.`)
    } else if (event.entityLinks.audience === "watchlist") {
      actions.push(`Refresh the ${symbol} watchlist setup before the next research pass.`)
    } else {
      actions.push(`Track whether ${symbol} belongs in today's broader market scan.`)
    }
  }

  if (mode === "pre-earnings") {
    actions.push(`Refresh the ${symbol} pre-earnings scenario grid with this event delta.`)
    if (event.classification === "guidance_update" || event.classification === "earnings_result") {
      actions.push(`Update the ${symbol} management question list and expectation map.`)
    }
  }

  if (mode === "post-earnings") {
    actions.push(`Compare this event against the reported ${symbol} outcome and update the post-earnings review.`)
  }

  if (event.direction === "negative" || event.materiality.band === "critical") {
    actions.push(`Escalate risk review for ${symbol}.`)
  } else if (event.direction === "positive") {
    actions.push(`Check whether upside catalysts or estimate expectations should move for ${symbol}.`)
  }

  return [...new Set(actions)]
}

function renderDeltaLine(event: InvestingEventRecord): string {
  const parts = [
    `${event.title}`,
    `${classificationLabel(event.classification)} / ${event.direction}`,
    `${event.materiality.band} ${event.materiality.score}/100`,
    audienceLabel(event.entityLinks.audience),
  ]
  if (event.entityLinks.sectorLabels.length > 0) {
    parts.push(`sectors: ${event.entityLinks.sectorLabels.join(", ")}`)
  }
  parts.push(event.summary)
  return parts.join(" | ")
}

async function collectCandidateEvents(input: {
  mode: InvestingEventDeltaMode
  stateFile?: string
  symbols: string[]
  limit: number
}): Promise<InvestingEventRecord[]> {
  const fetchLimit = Math.max(input.limit * 3, 12)
  if (input.symbols.length > 0) {
    const batches = await Promise.all(
      input.symbols.map((symbol) =>
        listInvestingEvents({
          stateFile: input.stateFile,
          symbol,
          limit: fetchLimit,
        }),
      ),
    )
    return dedupeEvents(batches.flat())
  }

  if (input.mode === "daily") {
    const [holdingEvents, watchlistEvents, generalEvents] = await Promise.all([
      listInvestingEvents({
        stateFile: input.stateFile,
        holdingOnly: true,
        limit: fetchLimit,
      }),
      listInvestingEvents({
        stateFile: input.stateFile,
        watchlistOnly: true,
        limit: fetchLimit,
      }),
      listInvestingEvents({
        stateFile: input.stateFile,
        limit: fetchLimit,
      }),
    ])
    return dedupeEvents([...holdingEvents, ...watchlistEvents, ...generalEvents])
  }

  return listInvestingEvents({
    stateFile: input.stateFile,
    limit: fetchLimit,
  })
}

export async function buildInvestingEventDeltaBrief(input: {
  mode: InvestingEventDeltaMode
  stateFile?: string
  symbols?: string[]
  limit?: number
}): Promise<InvestingEventDeltaBrief> {
  const symbols = normalizeSymbols(input.symbols)
  const limit = Math.max(1, Math.min(10, input.limit ?? 5))
  const minimumBand = minimumBandForMode(input.mode)
  const candidates = await collectCandidateEvents({
    mode: input.mode,
    stateFile: input.stateFile,
    symbols,
    limit,
  })
  const filtered = candidates
    .filter((event) => bandRank(event.materiality.band) >= bandRank(minimumBand))
    .sort((left, right) => {
      const weightedLeft = left.materiality.score + modeWeight(input.mode, left)
      const weightedRight = right.materiality.score + modeWeight(input.mode, right)
      if (weightedRight !== weightedLeft) return weightedRight - weightedLeft
      return right.asOf.localeCompare(left.asOf)
    })
    .slice(0, limit)

  const generatedAt = new Date().toISOString()
  const items = filtered.map<InvestingEventDeltaItem>((event) => ({
    id: `event-delta:${input.mode}:${event.id}`,
    eventId: event.id,
    symbol: event.symbol,
    asOf: event.asOf,
    headline: event.title,
    delta: renderDeltaLine(event),
    classification: event.classification,
    direction: event.direction,
    materialityBand: event.materiality.band,
    materialityScore: event.materiality.score,
    audience: event.entityLinks.audience,
    sectors: event.entityLinks.sectorLabels,
    implications: implicationsForEvent(event, input.mode),
  }))
  const scope = symbols.length > 0 ? symbols.join(", ") : "current coverage"
  const summary =
    items.length > 0
      ? `${items.length} event delta(s) selected for ${input.mode} briefing across ${scope}.`
      : `No qualifying event deltas for ${input.mode} briefing across ${scope}.`

  FluxRecorder.record({
    traceID: `event-delta:${input.mode}:${generatedAt}`,
    direction: "internal",
    domain: "investing",
    kind: "investing.event.delta",
    status: "ok",
    method: "briefing",
    path: input.mode,
    route: symbols.join(",") || "coverage",
    metadata: {
      mode: input.mode,
      symbols,
      itemCount: items.length,
      maxMaterialityScore: items[0]?.materialityScore ?? 0,
      audiences: [...new Set(items.map((item) => item.audience))],
      eventIds: items.map((item) => item.eventId),
    },
  })

  return {
    id: `event-delta-brief:${input.mode}:${generatedAt}`,
    mode: input.mode,
    generatedAt,
    symbols,
    summary,
    items,
  }
}

export function renderInvestingEventDeltaBrief(brief: InvestingEventDeltaBrief): string {
  if (brief.items.length === 0) {
    return ["Event Deltas:", `- ${brief.summary}`].join("\n")
  }

  const lines = ["Event Deltas:", `- ${brief.summary}`]
  for (const item of brief.items) {
    lines.push(
      `- ${item.symbol ?? "MARKET"} ${classificationLabel(item.classification)} (${item.materialityBand} ${item.materialityScore}/100, ${item.direction}, ${item.audience})`,
    )
    lines.push(`  ${item.delta}`)
    lines.push(`  Implications: ${item.implications.join(" | ")}`)
  }
  return lines.join("\n")
}
