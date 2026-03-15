import fs from "node:fs/promises"
import path from "node:path"
import type { EarningsAnalysis, Filing, MarketData } from "@zee/investing-sdk"
import z from "zod"
import { FluxRecorder } from "@/flux"
import { Global } from "@/global"

const ENTITY_SCHEMA_VERSION = 1 as const
const ENTITY_STATE_FILE = path.join(Global.Path.state, "investing-entity-catalog.json")

export const INVESTING_ENTITY_KINDS = [
  "company",
  "instrument",
  "filing",
  "event",
  "thesis",
  "catalyst",
  "risk",
  "valuation_case",
] as const

export const INVESTING_LINEAGE_SOURCES = [
  "filings",
  "earnings",
  "transcripts",
  "market",
  "macro",
  "news",
  "manual",
  "derived",
] as const

export type InvestingEntityKind = (typeof INVESTING_ENTITY_KINDS)[number]
export type InvestingLineageSource = (typeof INVESTING_LINEAGE_SOURCES)[number]

export const InvestingEntityKindSchema = z.enum(INVESTING_ENTITY_KINDS)
export const InvestingLineageSourceSchema = z.enum(INVESTING_LINEAGE_SOURCES)

export const InvestingEntityEvidenceSchema = z.object({
  label: z.string(),
  value: z.string(),
  url: z.string().optional(),
})

export const InvestingEntityLineageSchema = z.object({
  source: InvestingLineageSourceSchema,
  sourceType: z.string(),
  sourceId: z.string(),
  parentIds: z.array(z.string()).default([]),
  collectedAt: z.string(),
  evidence: z.array(InvestingEntityEvidenceSchema).default([]),
})

export const NormalizedInvestingEntitySchema = z.object({
  id: z.string(),
  version: z.literal(ENTITY_SCHEMA_VERSION),
  kind: InvestingEntityKindSchema,
  subtype: z.string().optional(),
  title: z.string(),
  asOf: z.string(),
  identifiers: z.object({
    canonical: z.string(),
    symbol: z.string().optional(),
    company: z.string().optional(),
    instrument: z.string().optional(),
    external: z.record(z.string(), z.string()).default({}),
  }),
  relatedIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.unknown()).default({}),
  lineage: InvestingEntityLineageSchema,
})

export const InvestingEntityCatalogSchema = z.object({
  version: z.literal(ENTITY_SCHEMA_VERSION),
  updatedAt: z.number().int().nonnegative(),
  entities: z.record(z.string(), NormalizedInvestingEntitySchema),
})

export type NormalizedInvestingEntity = z.infer<typeof NormalizedInvestingEntitySchema>
type InvestingEntityCatalog = z.infer<typeof InvestingEntityCatalogSchema>

export type InvestingEntityCatalogStatus = {
  version: 1
  updatedAt: number
  totalEntities: number
  countsByKind: Record<InvestingEntityKind, number>
  countsByLineageSource: Record<InvestingLineageSource, number>
}

export type InvestingEntityCatalogUpdate = InvestingEntityCatalogStatus & {
  batchCount: number
  inserted: number
  updated: number
  batchKinds: InvestingEntityKind[]
}

type GenericRecord = Record<string, unknown>

function asRecord(value: unknown): GenericRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as GenericRecord
}

function asRecords(value: unknown): GenericRecord[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is GenericRecord => Boolean(asRecord(entry)))
  }
  const record = asRecord(value)
  if (!record) return []
  for (const key of ["items", "results", "records", "data", "articles", "news", "transcripts", "events"]) {
    const nested = record[key]
    if (Array.isArray(nested)) {
      return nested.filter((entry): entry is GenericRecord => Boolean(asRecord(entry)))
    }
  }
  return [record]
}

function normalizeSegment(value: unknown, fallback = "unknown"): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  if (typeof value !== "string") return fallback
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || fallback
}

function uppercaseSymbol(symbol: string | undefined): string | undefined {
  const normalized = symbol?.trim().toUpperCase()
  return normalized ? normalized : undefined
}

function extractString(record: GenericRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function toIsoString(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
  }
  return fallback
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function companyId(symbol: string) {
  return `company:equity:${normalizeSegment(symbol)}`
}

function instrumentId(symbol: string) {
  return `instrument:equity:${normalizeSegment(symbol)}`
}

function withDefaultCounts<const T extends readonly string[]>(items: T): Record<T[number], number> {
  return Object.fromEntries(items.map((item) => [item, 0])) as Record<T[number], number>
}

function dedupeEntities(entities: NormalizedInvestingEntity[]): NormalizedInvestingEntity[] {
  const byId = new Map<string, NormalizedInvestingEntity>()
  for (const entity of entities) {
    byId.set(entity.id, entity)
  }
  return [...byId.values()]
}

function createBaseEntity(input: {
  id: string
  kind: InvestingEntityKind
  subtype?: string
  title: string
  asOf: string
  symbol?: string
  company?: string
  instrument?: string
  external?: Record<string, string>
  relatedIds?: string[]
  tags?: string[]
  attributes?: Record<string, unknown>
  lineage: z.infer<typeof InvestingEntityLineageSchema>
}): NormalizedInvestingEntity {
  return NormalizedInvestingEntitySchema.parse({
    id: input.id,
    version: ENTITY_SCHEMA_VERSION,
    kind: input.kind,
    subtype: input.subtype,
    title: input.title,
    asOf: input.asOf,
    identifiers: {
      canonical: input.id,
      symbol: input.symbol,
      company: input.company,
      instrument: input.instrument,
      external: input.external ?? {},
    },
    relatedIds: input.relatedIds ?? [],
    tags: input.tags ?? [],
    attributes: input.attributes ?? {},
    lineage: input.lineage,
  })
}

function createCompanyEntity(input: {
  symbol: string
  collectedAt: string
  source: InvestingLineageSource
  sourceId: string
  title?: string
  attributes?: Record<string, unknown>
}): NormalizedInvestingEntity {
  const symbol = input.symbol.toUpperCase()
  const id = companyId(symbol)
  return createBaseEntity({
    id,
    kind: "company",
    title: input.title ?? symbol,
    asOf: input.collectedAt,
    symbol,
    company: id,
    external: {
      ticker: symbol,
    },
    attributes: {
      symbol,
      ...(input.attributes ?? {}),
    },
    tags: ["equity"],
    lineage: {
      source: input.source,
      sourceType: "company",
      sourceId: input.sourceId,
      collectedAt: input.collectedAt,
      parentIds: [],
      evidence: [{ label: "ticker", value: symbol }],
    },
  })
}

function createInstrumentEntity(input: {
  symbol: string
  collectedAt: string
  source: InvestingLineageSource
  sourceId: string
  attributes?: Record<string, unknown>
}): NormalizedInvestingEntity {
  const symbol = input.symbol.toUpperCase()
  const relatedCompanyId = companyId(symbol)
  const id = instrumentId(symbol)
  return createBaseEntity({
    id,
    kind: "instrument",
    title: symbol,
    asOf: input.collectedAt,
    symbol,
    company: relatedCompanyId,
    instrument: id,
    external: {
      ticker: symbol,
    },
    relatedIds: [relatedCompanyId],
    attributes: {
      symbol,
      assetClass: "equity",
      ...(input.attributes ?? {}),
    },
    tags: ["equity"],
    lineage: {
      source: input.source,
      sourceType: "instrument",
      sourceId: input.sourceId,
      collectedAt: input.collectedAt,
      parentIds: [relatedCompanyId],
      evidence: [{ label: "ticker", value: symbol }],
    },
  })
}

function normalizeFilings(symbol: string, filings: Filing[], collectedAt: string): NormalizedInvestingEntity[] {
  const normalizedSymbol = symbol.toUpperCase()
  const relatedCompanyId = companyId(normalizedSymbol)
  const relatedInstrumentId = instrumentId(normalizedSymbol)
  const entities: NormalizedInvestingEntity[] = [
    createCompanyEntity({
      symbol: normalizedSymbol,
      collectedAt,
      source: "filings",
      sourceId: normalizedSymbol,
    }),
    createInstrumentEntity({
      symbol: normalizedSymbol,
      collectedAt,
      source: "filings",
      sourceId: normalizedSymbol,
    }),
  ]

  for (const filing of filings) {
    const asOf = toIsoString(filing.filedDate, collectedAt)
    const sourceId = `${normalizedSymbol}:${filing.formType}:${filing.filedDate}`
    entities.push(
      createBaseEntity({
        id: `filing:equity:${normalizeSegment(normalizedSymbol)}:${normalizeSegment(filing.formType)}:${normalizeSegment(filing.filedDate)}`,
        kind: "filing",
        title: `${normalizedSymbol} ${filing.formType}`,
        asOf,
        symbol: normalizedSymbol,
        company: relatedCompanyId,
        instrument: relatedInstrumentId,
        external: {
          formType: filing.formType,
          filedDate: filing.filedDate,
          ...(filing.url ? { url: filing.url } : {}),
        },
        relatedIds: [relatedCompanyId, relatedInstrumentId],
        attributes: {
          symbol: normalizedSymbol,
          formType: filing.formType,
          filedDate: filing.filedDate,
          periodEnd: filing.periodEnd,
          description: filing.description,
          url: filing.url,
        },
        tags: ["sec", filing.formType.toLowerCase()],
        lineage: {
          source: "filings",
          sourceType: "sec_filing",
          sourceId,
          collectedAt,
          parentIds: [relatedCompanyId, relatedInstrumentId],
          evidence: [
            { label: "formType", value: filing.formType },
            { label: "filedDate", value: filing.filedDate },
            ...(filing.url ? [{ label: "url", value: filing.url, url: filing.url }] : []),
          ],
        },
      }),
    )
  }

  return dedupeEntities(entities)
}

function normalizeEarnings(symbol: string, analysis: EarningsAnalysis, collectedAt: string): NormalizedInvestingEntity[] {
  const normalizedSymbol = symbol.toUpperCase()
  const relatedCompanyId = companyId(normalizedSymbol)
  const relatedInstrumentId = instrumentId(normalizedSymbol)
  const entities: NormalizedInvestingEntity[] = [
    createCompanyEntity({
      symbol: normalizedSymbol,
      collectedAt,
      source: "earnings",
      sourceId: normalizedSymbol,
    }),
    createInstrumentEntity({
      symbol: normalizedSymbol,
      collectedAt,
      source: "earnings",
      sourceId: normalizedSymbol,
    }),
  ]

  analysis.quarters.forEach((quarter, index) => {
    const record = asRecord(quarter) ?? {}
    const quarterLabel =
      extractString(record, "quarter", "fiscalQuarter", "label", "period") ?? `quarter-${index + 1}`
    const asOf = toIsoString(record.date ?? record.reportDate ?? record.periodEnd, collectedAt)
    const sourceId = `${normalizedSymbol}:${quarterLabel}:${asOf}`

    entities.push(
      createBaseEntity({
        id: `event:earnings:${normalizeSegment(normalizedSymbol)}:${normalizeSegment(quarterLabel)}:${normalizeSegment(asOf)}`,
        kind: "event",
        subtype: "earnings",
        title: `${normalizedSymbol} earnings ${quarterLabel}`,
        asOf,
        symbol: normalizedSymbol,
        company: relatedCompanyId,
        instrument: relatedInstrumentId,
        external: {
          quarter: quarterLabel,
        },
        relatedIds: [relatedCompanyId, relatedInstrumentId],
        attributes: {
          symbol: normalizedSymbol,
          quarter: quarterLabel,
          summary: {
            epsGrowthYoy: analysis.epsGrowthYoy,
            avgEpsSurprisePercent: analysis.avgEpsSurprisePercent,
            beatRate: analysis.beatRate,
            earningsConsistency: analysis.earningsConsistency,
          },
          quarterData: quarter,
        },
        tags: ["earnings"],
        lineage: {
          source: "earnings",
          sourceType: "earnings_analysis",
          sourceId,
          collectedAt,
          parentIds: [relatedCompanyId, relatedInstrumentId],
          evidence: [
            { label: "quarter", value: quarterLabel },
            { label: "symbol", value: normalizedSymbol },
          ],
        },
      }),
    )
  })

  return dedupeEntities(entities)
}

function normalizeMarket(symbol: string, marketData: MarketData, collectedAt: string): NormalizedInvestingEntity[] {
  const normalizedSymbol = symbol.toUpperCase()
  const relatedCompanyId = companyId(normalizedSymbol)
  const relatedInstrumentId = instrumentId(normalizedSymbol)
  const asOf = toIsoString(marketData.timestamp, collectedAt)
  return dedupeEntities([
    createCompanyEntity({
      symbol: normalizedSymbol,
      collectedAt,
      source: "market",
      sourceId: normalizedSymbol,
    }),
    createInstrumentEntity({
      symbol: normalizedSymbol,
      collectedAt,
      source: "market",
      sourceId: normalizedSymbol,
      attributes: {
        price: marketData.price,
        marketCap: marketData.marketCap,
      },
    }),
    createBaseEntity({
      id: `event:market_snapshot:${normalizeSegment(normalizedSymbol)}:${normalizeSegment(asOf)}`,
      kind: "event",
      subtype: "market_snapshot",
      title: `${normalizedSymbol} market snapshot`,
      asOf,
      symbol: normalizedSymbol,
      company: relatedCompanyId,
      instrument: relatedInstrumentId,
      relatedIds: [relatedCompanyId, relatedInstrumentId],
      attributes: {
        ...marketData,
      },
      tags: ["market"],
      lineage: {
        source: "market",
        sourceType: "market_snapshot",
        sourceId: `${normalizedSymbol}:${asOf}`,
        collectedAt,
        parentIds: [relatedCompanyId, relatedInstrumentId],
        evidence: [{ label: "timestamp", value: asOf }],
      },
    }),
  ])
}

function createUnstructuredEventEntities(input: {
  source: "transcripts" | "news" | "macro"
  subtype: string
  records: GenericRecord[]
  collectedAt: string
}): NormalizedInvestingEntity[] {
  const entities: NormalizedInvestingEntity[] = []

  input.records.forEach((record, index) => {
    const symbol = uppercaseSymbol(extractString(record, "symbol", "ticker", "companySymbol"))
    const title =
      extractString(record, "title", "headline", "name", "description", "event") ??
      `${input.subtype} ${index + 1}`
    const asOf = toIsoString(
      record.publishedAt ?? record.timestamp ?? record.date ?? record.datetime ?? record.lastUpdate,
      input.collectedAt,
    )
    const country = extractString(record, "country", "region")
    const code = extractString(record, "code", "id", "uuid", "eventCode")
    const sourceId =
      extractString(record, "id", "uuid", "transcriptId", "articleId", "url") ??
      [symbol ?? country ?? "global", code ?? title, asOf].map((part) => normalizeSegment(part)).join(":")

    let relatedIds: string[] = []
    let company: string | undefined
    let instrument: string | undefined
    if (symbol) {
      company = companyId(symbol)
      instrument = instrumentId(symbol)
      relatedIds = [company, instrument]
      entities.push(
        createCompanyEntity({
          symbol,
          collectedAt: input.collectedAt,
          source: input.source,
          sourceId,
          title: symbol,
        }),
      )
      entities.push(
        createInstrumentEntity({
          symbol,
          collectedAt: input.collectedAt,
          source: input.source,
          sourceId,
        }),
      )
    }

    entities.push(
      createBaseEntity({
        id: `event:${normalizeSegment(input.subtype)}:${normalizeSegment(symbol ?? country ?? "global")}:${normalizeSegment(sourceId)}`,
        kind: "event",
        subtype: input.subtype,
        title,
        asOf,
        symbol,
        company,
        instrument,
        relatedIds,
        external: {
          ...(country ? { country } : {}),
          ...(extractString(record, "url") ? { url: extractString(record, "url")! } : {}),
        },
        attributes: {
          ...record,
        },
        tags: unique([input.subtype, symbol ? "equity" : "macro"]),
        lineage: {
          source: input.source,
          sourceType: input.subtype,
          sourceId,
          collectedAt: input.collectedAt,
          parentIds: relatedIds,
          evidence: [
            { label: "title", value: title },
            ...(extractString(record, "url") ? [{ label: "url", value: extractString(record, "url")!, url: extractString(record, "url")! }] : []),
          ],
        },
      }),
    )
  })

  return dedupeEntities(entities)
}

export function normalizeInvestingConnectorEntities(input: {
  connector: "filings" | "earnings" | "transcripts" | "market" | "macro" | "news"
  symbol?: string
  data: unknown
  collectedAt?: string
}): NormalizedInvestingEntity[] {
  const collectedAt = toIsoString(input.collectedAt ?? Date.now(), new Date().toISOString())
  switch (input.connector) {
    case "filings":
      return input.symbol ? normalizeFilings(input.symbol, Array.isArray(input.data) ? (input.data as Filing[]) : [], collectedAt) : []
    case "earnings":
      return input.symbol && asRecord(input.data)
        ? normalizeEarnings(input.symbol, input.data as EarningsAnalysis, collectedAt)
        : []
    case "market":
      return input.symbol && asRecord(input.data)
        ? normalizeMarket(input.symbol, input.data as MarketData, collectedAt)
        : []
    case "macro":
      return createUnstructuredEventEntities({
        source: "macro",
        subtype: "macro_calendar",
        records: asRecords(input.data),
        collectedAt,
      })
    case "transcripts":
      return createUnstructuredEventEntities({
        source: "transcripts",
        subtype: "transcript",
        records: asRecords(input.data),
        collectedAt,
      })
    case "news":
      return createUnstructuredEventEntities({
        source: "news",
        subtype: "news",
        records: asRecords(input.data),
        collectedAt,
      })
  }
}

function defaultCatalog(): InvestingEntityCatalog {
  return {
    version: ENTITY_SCHEMA_VERSION,
    updatedAt: 0,
    entities: {},
  }
}

async function readCatalog(stateFile = ENTITY_STATE_FILE): Promise<InvestingEntityCatalog> {
  const raw = await fs.readFile(stateFile, "utf8").catch(() => "")
  if (!raw) return defaultCatalog()
  try {
    return InvestingEntityCatalogSchema.parse(JSON.parse(raw))
  } catch {
    return defaultCatalog()
  }
}

async function writeCatalog(state: InvestingEntityCatalog, stateFile = ENTITY_STATE_FILE): Promise<void> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8")
}

function summarizeCatalog(state: InvestingEntityCatalog): InvestingEntityCatalogStatus {
  const countsByKind = withDefaultCounts(INVESTING_ENTITY_KINDS)
  const countsByLineageSource = withDefaultCounts(INVESTING_LINEAGE_SOURCES)

  for (const entity of Object.values(state.entities)) {
    countsByKind[entity.kind] += 1
    countsByLineageSource[entity.lineage.source] += 1
  }

  return {
    version: ENTITY_SCHEMA_VERSION,
    updatedAt: state.updatedAt,
    totalEntities: Object.keys(state.entities).length,
    countsByKind,
    countsByLineageSource,
  }
}

export async function upsertInvestingEntities(input: {
  entities: NormalizedInvestingEntity[]
  stateFile?: string
}): Promise<InvestingEntityCatalogUpdate> {
  const state = await readCatalog(input.stateFile)
  let inserted = 0
  let updated = 0
  const batchKinds = new Set<InvestingEntityKind>()

  for (const candidate of input.entities) {
    const entity = NormalizedInvestingEntitySchema.parse(candidate)
    batchKinds.add(entity.kind)
    if (state.entities[entity.id]) updated += 1
    else inserted += 1
    state.entities[entity.id] = entity
  }

  state.updatedAt = Date.now()
  await writeCatalog(state, input.stateFile)
  const status = summarizeCatalog(state)
  const batchKindList = [...batchKinds].sort()

  FluxRecorder.record({
    traceID: crypto.randomUUID(),
    direction: "internal",
    domain: "investing",
    kind: "investing.entity.normalized",
    status: "ok",
    method: "normalizer",
    path: "catalog",
    route: "investing-entity-catalog",
    metadata: {
      batchCount: input.entities.length,
      inserted,
      updated,
      totalEntities: status.totalEntities,
      batchKinds: batchKindList,
      countsByKind: status.countsByKind,
      countsByLineageSource: status.countsByLineageSource,
    },
  })

  return {
    ...status,
    batchCount: input.entities.length,
    inserted,
    updated,
    batchKinds: batchKindList,
  }
}

export async function getInvestingEntityCatalogStatus(options: {
  stateFile?: string
} = {}): Promise<InvestingEntityCatalogStatus> {
  return summarizeCatalog(await readCatalog(options.stateFile))
}
