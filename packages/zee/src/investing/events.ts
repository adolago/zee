import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { FluxRecorder } from "@/flux"
import { Global } from "@/global"
import type { NormalizedInvestingEntity } from "./entities"

const EVENT_SCHEMA_VERSION = 1 as const
const EVENT_STATE_FILE = path.join(Global.Path.state, "investing-event-intelligence.json")

export const INVESTING_EVENT_CONNECTORS = ["earnings", "news"] as const
export const INVESTING_EVENT_CLASSIFICATIONS = [
  "earnings_result",
  "guidance_update",
  "mna",
  "management_change",
  "legal_regulatory",
  "product_and_partnership",
  "capital_allocation",
  "general_news",
] as const
export const INVESTING_EVENT_DIRECTIONS = ["positive", "negative", "neutral", "mixed", "unknown"] as const

export type InvestingEventConnector = (typeof INVESTING_EVENT_CONNECTORS)[number]
export type InvestingEventClassification = (typeof INVESTING_EVENT_CLASSIFICATIONS)[number]
export type InvestingEventDirection = (typeof INVESTING_EVENT_DIRECTIONS)[number]

const InvestingEventConnectorSchema = z.enum(INVESTING_EVENT_CONNECTORS)
const InvestingEventClassificationSchema = z.enum(INVESTING_EVENT_CLASSIFICATIONS)
const InvestingEventDirectionSchema = z.enum(INVESTING_EVENT_DIRECTIONS)

export const InvestingEventRecordSchema = z.object({
  id: z.string(),
  version: z.literal(EVENT_SCHEMA_VERSION),
  connector: InvestingEventConnectorSchema,
  classification: InvestingEventClassificationSchema,
  direction: InvestingEventDirectionSchema,
  confidence: z.number().min(0).max(1),
  title: z.string(),
  summary: z.string(),
  asOf: z.string(),
  capturedAt: z.string(),
  symbol: z.string().optional(),
  entityId: z.string(),
  companyId: z.string().optional(),
  instrumentId: z.string().optional(),
  relatedIds: z.array(z.string()).default([]),
  sourceId: z.string(),
  sourceType: z.string(),
  sourceUrl: z.string().optional(),
  tags: z.array(z.string()).default([]),
  reasons: z.array(z.string()).default([]),
})

export const InvestingEventCatalogSchema = z.object({
  version: z.literal(EVENT_SCHEMA_VERSION),
  updatedAt: z.number().int().nonnegative(),
  events: z.record(z.string(), InvestingEventRecordSchema),
})

export type InvestingEventRecord = z.infer<typeof InvestingEventRecordSchema>
type InvestingEventCatalog = z.infer<typeof InvestingEventCatalogSchema>

export type InvestingEventCatalogStatus = {
  version: 1
  updatedAt: number
  totalEvents: number
  countsByConnector: Record<InvestingEventConnector, number>
  countsByClassification: Record<InvestingEventClassification, number>
  countsByDirection: Record<InvestingEventDirection, number>
}

export type InvestingEventCatalogUpdate = InvestingEventCatalogStatus & {
  batchCount: number
  inserted: number
  updated: number
}

type GenericRecord = Record<string, unknown>

const POSITIVE_KEYWORDS = [
  "beat",
  "beats",
  "raise",
  "raises",
  "raised",
  "strong",
  "surge",
  "surges",
  "approval",
  "approved",
  "win",
  "wins",
  "record",
  "growth",
  "buyback",
  "partnership",
  "launch",
]

const NEGATIVE_KEYWORDS = [
  "miss",
  "misses",
  "cut",
  "cuts",
  "warning",
  "warns",
  "warned",
  "probe",
  "investigation",
  "lawsuit",
  "litigation",
  "recall",
  "delay",
  "delays",
  "layoffs",
  "downgrade",
  "weak",
  "slump",
  "drop",
  "antitrust",
]

const NEWS_CLASSIFICATION_RULES: Array<{
  classification: InvestingEventClassification
  keywords: string[]
}> = [
  {
    classification: "guidance_update",
    keywords: ["guidance", "outlook", "forecast", "reiterates", "raises outlook", "cuts outlook"],
  },
  {
    classification: "mna",
    keywords: ["acquire", "acquires", "acquisition", "merger", "buyout", "takeover", "deal", "divest"],
  },
  {
    classification: "management_change",
    keywords: ["ceo", "cfo", "chair", "board", "executive", "appoints", "appointment", "resigns", "steps down"],
  },
  {
    classification: "legal_regulatory",
    keywords: ["lawsuit", "litigation", "settlement", "investigation", "probe", "sec", "doj", "ftc", "antitrust", "fine", "penalty"],
  },
  {
    classification: "capital_allocation",
    keywords: ["dividend", "buyback", "repurchase", "offering", "share sale", "debt", "bond", "capital return"],
  },
  {
    classification: "product_and_partnership",
    keywords: ["launch", "release", "partnership", "contract", "customer", "order", "approval", "deal win"],
  },
  {
    classification: "earnings_result",
    keywords: ["earnings", "eps", "revenue", "quarter", "q1", "q2", "q3", "q4"],
  },
]

function asRecord(value: unknown): GenericRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as GenericRecord
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase()
}

function trimSentence(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function withDefaultCounts<const T extends readonly string[]>(items: T): Record<T[number], number> {
  return Object.fromEntries(items.map((item) => [item, 0])) as Record<T[number], number>
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.parseFloat(value.toFixed(2))))
}

function dedupeEvents(events: InvestingEventRecord[]): InvestingEventRecord[] {
  const byId = new Map<string, InvestingEventRecord>()
  for (const event of events) {
    byId.set(event.id, event)
  }
  return [...byId.values()]
}

function extractSourceUrl(entity: NormalizedInvestingEntity): string | undefined {
  const fromIdentifiers = entity.identifiers.external.url
  if (fromIdentifiers) return fromIdentifiers
  for (const evidence of entity.lineage.evidence) {
    if (evidence.url) return evidence.url
  }
  return undefined
}

function entityText(entity: NormalizedInvestingEntity): string {
  const attributes = asRecord(entity.attributes) ?? {}
  const parts = [
    entity.title,
    typeof attributes.summary === "string" ? attributes.summary : undefined,
    typeof attributes.description === "string" ? attributes.description : undefined,
    typeof attributes.body === "string" ? attributes.body : undefined,
    typeof attributes.snippet === "string" ? attributes.snippet : undefined,
    typeof attributes.headline === "string" ? attributes.headline : undefined,
  ]
  return normalizeText(parts.filter((part): part is string => Boolean(part)).join(" "))
}

function classifyDirection(text: string, fallback: InvestingEventDirection = "neutral"): InvestingEventDirection {
  const positiveHits = POSITIVE_KEYWORDS.filter((keyword) => text.includes(keyword)).length
  const negativeHits = NEGATIVE_KEYWORDS.filter((keyword) => text.includes(keyword)).length
  if (positiveHits > 0 && negativeHits > 0) return "mixed"
  if (positiveHits > 0) return "positive"
  if (negativeHits > 0) return "negative"
  return fallback
}

function classifyNewsEntity(entity: NormalizedInvestingEntity): {
  classification: InvestingEventClassification
  direction: InvestingEventDirection
  confidence: number
  reasons: string[]
} {
  const text = entityText(entity)
  const reasons: string[] = []

  for (const rule of NEWS_CLASSIFICATION_RULES) {
    const hits = rule.keywords.filter((keyword) => text.includes(keyword))
    if (hits.length === 0) continue
    reasons.push(`matched ${rule.classification} keywords: ${hits.join(", ")}`)
    return {
      classification: rule.classification,
      direction: classifyDirection(text, "neutral"),
      confidence: clampConfidence(0.7 + Math.min(0.2, hits.length * 0.08) + (entity.identifiers.symbol ? 0.05 : 0)),
      reasons,
    }
  }

  reasons.push("no high-signal keyword match; falling back to general_news")
  return {
    classification: "general_news",
    direction: classifyDirection(text, "unknown"),
    confidence: clampConfidence(0.55 + (entity.identifiers.symbol ? 0.05 : 0)),
    reasons,
  }
}

function summarizeEarningsEntity(entity: NormalizedInvestingEntity, classification: InvestingEventClassification): string {
  const attributes = asRecord(entity.attributes) ?? {}
  const summary = asRecord(attributes.summary) ?? {}
  const quarter = typeof attributes.quarter === "string" ? attributes.quarter : undefined
  const symbol = entity.identifiers.symbol ?? entity.title
  const parts = [`${symbol}${quarter ? ` ${quarter}` : ""} classified as ${classification.replace(/_/g, " ")}`]

  if (typeof summary.avgEpsSurprisePercent === "number") {
    parts.push(`avg EPS surprise ${summary.avgEpsSurprisePercent.toFixed(1)}%`)
  }
  if (typeof summary.epsGrowthYoy === "number") {
    parts.push(`EPS growth YoY ${summary.epsGrowthYoy.toFixed(1)}%`)
  }

  return trimSentence(parts.join("; "))
}

function summarizeNewsEntity(entity: NormalizedInvestingEntity, classification: InvestingEventClassification): string {
  const attributes = asRecord(entity.attributes) ?? {}
  const summary =
    typeof attributes.summary === "string"
      ? attributes.summary
      : typeof attributes.description === "string"
        ? attributes.description
        : entity.title

  return trimSentence(`${classification.replace(/_/g, " ")} :: ${summary}`)
}

function createEventRecord(input: {
  connector: InvestingEventConnector
  entity: NormalizedInvestingEntity
  capturedAt: string
}): InvestingEventRecord | undefined {
  if (input.entity.kind !== "event") return undefined

  const entity = input.entity
  const sourceUrl = extractSourceUrl(entity)
  const symbol = entity.identifiers.symbol

  if (input.connector === "earnings") {
    const text = entityText(entity)
    const classification = text.includes("guidance") || text.includes("outlook") ? "guidance_update" : "earnings_result"
    const attributes = asRecord(entity.attributes) ?? {}
    const summary = asRecord(attributes.summary) ?? {}
    const surprise = typeof summary.avgEpsSurprisePercent === "number" ? summary.avgEpsSurprisePercent : undefined
    const direction =
      typeof surprise === "number"
        ? surprise > 0
          ? "positive"
          : surprise < 0
            ? "negative"
            : classifyDirection(text, "neutral")
        : classifyDirection(text, "neutral")

    return InvestingEventRecordSchema.parse({
      id: `classified:${entity.id}`,
      version: EVENT_SCHEMA_VERSION,
      connector: input.connector,
      classification,
      direction,
      confidence: 0.95,
      title: entity.title,
      summary: summarizeEarningsEntity(entity, classification),
      asOf: entity.asOf,
      capturedAt: input.capturedAt,
      symbol,
      entityId: entity.id,
      companyId: entity.identifiers.company,
      instrumentId: entity.identifiers.instrument,
      relatedIds: entity.relatedIds,
      sourceId: entity.lineage.sourceId,
      sourceType: entity.lineage.sourceType,
      sourceUrl,
      tags: [...new Set(["earnings", ...entity.tags])],
      reasons: classification === "guidance_update" ? ["earnings text included guidance/outlook language"] : ["earnings connector event"],
    })
  }

  const classified = classifyNewsEntity(entity)
  return InvestingEventRecordSchema.parse({
    id: `classified:${entity.id}`,
    version: EVENT_SCHEMA_VERSION,
    connector: input.connector,
    classification: classified.classification,
    direction: classified.direction,
    confidence: classified.confidence,
    title: entity.title,
    summary: summarizeNewsEntity(entity, classified.classification),
    asOf: entity.asOf,
    capturedAt: input.capturedAt,
    symbol,
    entityId: entity.id,
    companyId: entity.identifiers.company,
    instrumentId: entity.identifiers.instrument,
    relatedIds: entity.relatedIds,
    sourceId: entity.lineage.sourceId,
    sourceType: entity.lineage.sourceType,
    sourceUrl,
    tags: [...new Set(["news", classified.classification, ...entity.tags])],
    reasons: classified.reasons,
  })
}

function defaultCatalog(): InvestingEventCatalog {
  return {
    version: EVENT_SCHEMA_VERSION,
    updatedAt: 0,
    events: {},
  }
}

async function readCatalog(stateFile = EVENT_STATE_FILE): Promise<InvestingEventCatalog> {
  const raw = await fs.readFile(stateFile, "utf8").catch(() => "")
  if (!raw) return defaultCatalog()
  try {
    return InvestingEventCatalogSchema.parse(JSON.parse(raw))
  } catch {
    return defaultCatalog()
  }
}

async function writeCatalog(catalog: InvestingEventCatalog, stateFile = EVENT_STATE_FILE): Promise<void> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, JSON.stringify(catalog, null, 2) + "\n", "utf8")
}

function buildStatus(catalog: InvestingEventCatalog): InvestingEventCatalogStatus {
  const countsByConnector = withDefaultCounts(INVESTING_EVENT_CONNECTORS)
  const countsByClassification = withDefaultCounts(INVESTING_EVENT_CLASSIFICATIONS)
  const countsByDirection = withDefaultCounts(INVESTING_EVENT_DIRECTIONS)

  for (const event of Object.values(catalog.events)) {
    countsByConnector[event.connector] += 1
    countsByClassification[event.classification] += 1
    countsByDirection[event.direction] += 1
  }

  return {
    version: 1,
    updatedAt: catalog.updatedAt,
    totalEvents: Object.keys(catalog.events).length,
    countsByConnector,
    countsByClassification,
    countsByDirection,
  }
}

export function classifyInvestingConnectorEvents(input: {
  connector: InvestingEventConnector
  entities: NormalizedInvestingEntity[]
  capturedAt?: string
}): InvestingEventRecord[] {
  const capturedAt = input.capturedAt ?? new Date().toISOString()
  return dedupeEvents(
    input.entities
      .map((entity) =>
        createEventRecord({
          connector: input.connector,
          entity,
          capturedAt,
        }),
      )
      .filter((event): event is InvestingEventRecord => Boolean(event)),
  )
}

export async function upsertInvestingEvents(input: {
  events: InvestingEventRecord[]
  stateFile?: string
}): Promise<InvestingEventCatalogUpdate> {
  if (input.events.length === 0) {
    const status = buildStatus(await readCatalog(input.stateFile))
    return {
      ...status,
      batchCount: 0,
      inserted: 0,
      updated: 0,
    }
  }

  const catalog = await readCatalog(input.stateFile)
  let inserted = 0
  let updated = 0

  for (const event of input.events) {
    const existed = Boolean(catalog.events[event.id])
    if (existed) updated += 1
    else inserted += 1
    catalog.events[event.id] = event

    FluxRecorder.record({
      traceID: crypto.randomUUID(),
      direction: "internal",
      domain: "investing",
      kind: "investing.event.classified",
      status: "ok",
      method: "classifier",
      path: event.connector,
      route: event.classification,
      metadata: {
        eventId: event.id,
        entityId: event.entityId,
        connector: event.connector,
        classification: event.classification,
        direction: event.direction,
        confidence: event.confidence,
        symbol: event.symbol,
        mode: existed ? "updated" : "inserted",
      },
    })
  }

  catalog.updatedAt = Date.now()
  await writeCatalog(catalog, input.stateFile)
  const status = buildStatus(catalog)
  return {
    ...status,
    batchCount: input.events.length,
    inserted,
    updated,
  }
}

export async function getInvestingEventCatalogStatus(stateFile = EVENT_STATE_FILE): Promise<InvestingEventCatalogStatus> {
  return buildStatus(await readCatalog(stateFile))
}

export async function listInvestingEvents(options: {
  stateFile?: string
  connector?: InvestingEventConnector
  classification?: InvestingEventClassification
  direction?: InvestingEventDirection
  symbol?: string
  limit?: number
} = {}): Promise<InvestingEventRecord[]> {
  const catalog = await readCatalog(options.stateFile)
  const symbol = options.symbol?.trim().toUpperCase()
  const limit = Math.max(1, Math.min(200, options.limit ?? 20))

  return Object.values(catalog.events)
    .filter((event) => (options.connector ? event.connector === options.connector : true))
    .filter((event) => (options.classification ? event.classification === options.classification : true))
    .filter((event) => (options.direction ? event.direction === options.direction : true))
    .filter((event) => (symbol ? event.symbol === symbol : true))
    .sort((left, right) => right.asOf.localeCompare(left.asOf))
    .slice(0, limit)
}

export async function getInvestingEvent(eventId: string, stateFile = EVENT_STATE_FILE): Promise<InvestingEventRecord | undefined> {
  const catalog = await readCatalog(stateFile)
  return catalog.events[eventId]
}
