/**
 * Investing Thesis Query And Rollup Views
 *
 * Query helpers layered on top of the persisted thesis ledger so operators can
 * read thesis history, compute revision diffs, and inspect portfolio-level
 * thesis coverage without mutating the underlying record state.
 */

import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { FluxRecorder } from "../../../packages/zee/src/flux"
import { Investing } from "../../paths"
import {
  INVESTING_THESIS_CONVICTIONS,
  INVESTING_THESIS_POSTURES,
  type InvestingThesisConfidenceAssessment,
  type InvestingThesisConviction,
  type InvestingThesisPosture,
  type InvestingThesisRecord,
  type InvestingThesisRecordStatus,
  type InvestingThesisRevision,
  getInvestingThesis,
  listInvestingTheses,
  thesisKeyForSymbol,
} from "./thesis"

export const INVESTING_THESIS_PORTFOLIO_ROLLUP_AUDIENCES = ["all", "holding", "watchlist"] as const
export type InvestingThesisPortfolioRollupAudience = (typeof INVESTING_THESIS_PORTFOLIO_ROLLUP_AUDIENCES)[number]

type PortfolioPosition = {
  symbol: string
  shares: number
  averageCost?: number
}

type WatchlistEntry = {
  symbol: string
}

export interface InvestingThesisHistory {
  thesisKey: string
  symbol: string
  currentVersion: number
  revisionCount: number
  revisions: InvestingThesisRevision[]
}

export interface InvestingThesisValueChange<T> {
  from: T
  to: T
  changed: boolean
}

export interface InvestingThesisCollectionChange<T> {
  added: T[]
  removed: T[]
  changed: boolean
}

export interface InvestingThesisDiff {
  thesisKey: string
  symbol: string
  fromRevision: Pick<
    InvestingThesisRevision,
    "id" | "version" | "createdAt" | "changeType" | "summary" | "conviction" | "posture"
  >
  toRevision: Pick<
    InvestingThesisRevision,
    "id" | "version" | "createdAt" | "changeType" | "summary" | "conviction" | "posture"
  >
  changedFields: string[]
  summary: string
  changes: {
    summary: InvestingThesisValueChange<string>
    thesis: InvestingThesisValueChange<string>
    conviction: InvestingThesisValueChange<InvestingThesisConviction>
    posture: InvestingThesisValueChange<InvestingThesisPosture>
    watchpoints: InvestingThesisCollectionChange<string>
    evidence: InvestingThesisCollectionChange<{
      kind: string
      id: string
      label: string
      link?: string
      toolId?: string
    }>
    valuation: InvestingThesisValueChange<{
      valuationCaseId?: string
      signal?: string
      fairValue?: number | null
      currentPrice?: number | null
      upsidePercent?: number | null
    } | null>
    confidence: InvestingThesisValueChange<{
      ruleVersion: string
      requestedConviction: InvestingThesisConviction
      appliedConviction: InvestingThesisConviction
      maxAllowedConviction: InvestingThesisConviction
      score: number
      evidenceCount: number
      uniqueTools: string[]
      reasons: string[]
    } | null>
  }
}

export interface InvestingThesisPortfolioRollupEntry {
  symbol: string
  audience: "holding" | "watchlist"
  shares?: number
  averageCost?: number
  thesis: null | {
    thesisKey: string
    status: InvestingThesisRecordStatus
    summary: string
    conviction: InvestingThesisConviction
    posture: InvestingThesisPosture
    currentVersion: number
    updatedAt: string
    confidence: InvestingThesisConfidenceAssessment | null
  }
  latestRevision: null | {
    revisionId: string
    version: number
    changeType: string
    createdAt: string
    summary: string
    evidenceCount: number
  }
  watchpoints: string[]
  valuation: InvestingThesisRecord["valuation"]
}

export interface InvestingThesisPortfolioRollup {
  schemaVersion: "investing-thesis-rollup.v1"
  createdAt: string
  audience: InvestingThesisPortfolioRollupAudience
  summary: string
  coverage: {
    holdingsCount: number
    watchlistCount: number
    thesisTrackedCount: number
    missingThesisCount: number
  }
  countsByPosture: Record<InvestingThesisPosture, number>
  countsByConviction: Record<InvestingThesisConviction, number>
  entries: InvestingThesisPortfolioRollupEntry[]
}

function normalizeSymbol(symbol: string | undefined): string {
  return symbol?.trim().toUpperCase() ?? ""
}

function defaultWatchlistFile(): string {
  return process.env.ZEE_INVESTING_WATCHLIST_FILE || path.join(os.homedir(), ".zee", "investing", "watchlist.json")
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined
  try {
    return JSON.parse(readFileSync(filePath, "utf8"))
  } catch {
    return undefined
  }
}

function loadPortfolioPositions(portfolioFile = Investing.portfolioFile()): PortfolioPosition[] {
  const parsed = readJsonFile(portfolioFile)
  const record = asRecord(parsed)
  const positions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.positions)
      ? record.positions
      : Array.isArray(record?.holdings)
        ? record.holdings
        : []

  return positions
    .map((entry): PortfolioPosition | null => {
      const item = asRecord(entry)
      if (!item) return null
      const symbol = normalizeSymbol(String(item.symbol ?? item.ticker ?? ""))
      const shares = parseNumber(item.shares ?? item.quantity ?? item.position)
      if (!symbol || !shares || shares <= 0) return null
      const averageCost = parseNumber(
        item.averageCost ?? item.average_cost ?? item.avg_cost ?? item.entryPrice ?? item.entry_price ?? item.price,
      )
      return { symbol, shares, averageCost }
    })
    .filter((entry): entry is PortfolioPosition => Boolean(entry))
}

function loadWatchlistEntries(input: { watchlistSymbols?: string[]; watchlistFile?: string }): WatchlistEntry[] {
  const parsed = readJsonFile(input.watchlistFile ?? defaultWatchlistFile())
  const record = asRecord(parsed)
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.watchlist)
        ? record.watchlist
        : Array.isArray(record?.symbols)
          ? record.symbols
          : []

  const symbols = [
    ...items.map((item) => {
      if (typeof item === "string") return normalizeSymbol(item)
      const value = asRecord(item)
      return normalizeSymbol(String(value?.symbol ?? value?.ticker ?? value?.code ?? ""))
    }),
    ...(input.watchlistSymbols ?? []).map((item) => normalizeSymbol(item)),
  ]

  return unique(symbols)
    .filter(Boolean)
    .map((symbol) => ({ symbol }))
}

function withDefaultCounts<const T extends readonly string[]>(items: T): Record<T[number], number> {
  return Object.fromEntries(items.map((item) => [item, 0])) as Record<T[number], number>
}

function recordQueryTelemetry(input: {
  kind: "investing.thesis.query" | "investing.thesis.rollup"
  traceID: string
  method: string
  path?: string
  route?: string
  metadata?: Record<string, unknown>
}): void {
  FluxRecorder.record({
    traceID: input.traceID,
    direction: "internal",
    domain: "investing",
    kind: input.kind,
    status: "ok",
    method: input.method,
    path: input.path,
    route: input.route,
    metadata: input.metadata,
  })
}

function resolveThesisKey(thesis: string): string {
  return thesis.startsWith("thesis:") ? thesis : thesisKeyForSymbol(thesis)
}

function resolveThesisRecord(thesis: string): InvestingThesisRecord | null {
  return getInvestingThesis(resolveThesisKey(thesis))
}

function equalStringArrays(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function diffStringArrays(left: string[], right: string[]): InvestingThesisCollectionChange<string> {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const added = right.filter((item) => !leftSet.has(item))
  const removed = left.filter((item) => !rightSet.has(item))
  return {
    added,
    removed,
    changed: added.length > 0 || removed.length > 0,
  }
}

function evidenceKey(item: { kind: string; id: string }): string {
  return `${item.kind}:${item.id}`
}

function diffEvidence(
  left: InvestingThesisRevision["evidence"],
  right: InvestingThesisRevision["evidence"],
): InvestingThesisCollectionChange<{
  kind: string
  id: string
  label: string
  link?: string
  toolId?: string
}> {
  const leftKeys = new Set(left.map((item) => evidenceKey(item)))
  const rightKeys = new Set(right.map((item) => evidenceKey(item)))
  const added = right.filter((item) => !leftKeys.has(evidenceKey(item)))
  const removed = left.filter((item) => !rightKeys.has(evidenceKey(item)))
  return {
    added,
    removed,
    changed: added.length > 0 || removed.length > 0,
  }
}

function sameConfidence(
  left: InvestingThesisConfidenceAssessment | null,
  right: InvestingThesisConfidenceAssessment | null,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return (
    left.ruleVersion === right.ruleVersion &&
    left.requestedConviction === right.requestedConviction &&
    left.appliedConviction === right.appliedConviction &&
    left.maxAllowedConviction === right.maxAllowedConviction &&
    left.score === right.score &&
    left.evidenceCount === right.evidenceCount &&
    equalStringArrays(left.uniqueTools, right.uniqueTools) &&
    equalStringArrays(left.reasons, right.reasons)
  )
}

function baselineConfidence(): InvestingThesisConfidenceAssessment {
  return {
    ruleVersion: "thesis-confidence.v1",
    requestedConviction: "low",
    appliedConviction: "low",
    maxAllowedConviction: "low",
    score: 0,
    evidenceCount: 0,
    uniqueTools: [],
    reasons: ["Baseline comparison before the first persisted thesis revision."],
  }
}

function makeBaselineRevision(record: InvestingThesisRecord): InvestingThesisRevision {
  return {
    id: `${record.id}:baseline`,
    version: 0,
    changeType: "initialize",
    createdAt: record.createdAt,
    summary: "No previously persisted thesis revision.",
    thesis: "",
    conviction: "low",
    posture: "neutral",
    watchpoints: [],
    valuation: null,
    evidence: [],
    confidence: baselineConfidence(),
    source: {},
  }
}

function findRevision(record: InvestingThesisRecord, version: number): InvestingThesisRevision {
  if (version === 0) return makeBaselineRevision(record)
  const revision = record.revisions.find((item) => item.version === version)
  if (!revision) {
    throw new Error(`Thesis revision v${version} not found for ${record.id}.`)
  }
  return revision
}

function sortRollupEntries(
  left: InvestingThesisPortfolioRollupEntry,
  right: InvestingThesisPortfolioRollupEntry,
): number {
  if (left.audience !== right.audience) return left.audience === "holding" ? -1 : 1
  return left.symbol.localeCompare(right.symbol)
}

export function queryInvestingThesisRecord(thesis: string): InvestingThesisRecord | null {
  const record = resolveThesisRecord(thesis)
  const thesisKey = resolveThesisKey(thesis)
  recordQueryTelemetry({
    kind: "investing.thesis.query",
    traceID: thesisKey,
    method: "read",
    path: record?.symbol ?? thesis.toUpperCase(),
    route: thesisKey,
    metadata: { found: Boolean(record) },
  })
  return record
}

export function queryInvestingTheses(options?: {
  symbol?: string
  status?: InvestingThesisRecordStatus
  conviction?: InvestingThesisConviction
  posture?: InvestingThesisPosture
  limit?: number
}): InvestingThesisRecord[] {
  const theses = listInvestingTheses({
    symbol: options?.symbol,
    status: options?.status,
    limit: Number.MAX_SAFE_INTEGER,
  })
    .filter((record) => (options?.conviction ? record.conviction === options.conviction : true))
    .filter((record) => (options?.posture ? record.posture === options.posture : true))
    .slice(0, options?.limit ?? 20)

  recordQueryTelemetry({
    kind: "investing.thesis.query",
    traceID: options?.symbol ? resolveThesisKey(options.symbol) : "thesis:list",
    method: "list",
    path: options?.symbol?.toUpperCase(),
    route: "investing:thesis:list",
    metadata: {
      count: theses.length,
      status: options?.status,
      conviction: options?.conviction,
      posture: options?.posture,
      limit: options?.limit ?? 20,
    },
  })

  return theses
}

export function getInvestingThesisHistory(input: { thesis: string; limit?: number }): InvestingThesisHistory | null {
  const record = resolveThesisRecord(input.thesis)
  const thesisKey = resolveThesisKey(input.thesis)
  recordQueryTelemetry({
    kind: "investing.thesis.query",
    traceID: thesisKey,
    method: "history",
    path: record?.symbol ?? input.thesis.toUpperCase(),
    route: thesisKey,
    metadata: { found: Boolean(record), limit: input.limit ?? 10 },
  })

  if (!record) return null
  const revisions = record.revisions.slice(0, input.limit ?? 10)
  return {
    thesisKey: record.id,
    symbol: record.symbol,
    currentVersion: record.currentVersion,
    revisionCount: record.revisions.length,
    revisions,
  }
}

export function diffInvestingThesisHistory(input: {
  thesis: string
  fromVersion?: number
  toVersion?: number
}): InvestingThesisDiff | null {
  const record = resolveThesisRecord(input.thesis)
  const thesisKey = resolveThesisKey(input.thesis)
  if (!record) {
    recordQueryTelemetry({
      kind: "investing.thesis.query",
      traceID: thesisKey,
      method: "diff",
      path: input.thesis.toUpperCase(),
      route: thesisKey,
      metadata: { found: false, fromVersion: input.fromVersion, toVersion: input.toVersion },
    })
    return null
  }

  const latestVersion = record.revisions[0]?.version ?? 0
  const toVersion = input.toVersion ?? latestVersion
  const fromVersion = input.fromVersion ?? Math.max(0, toVersion - 1)
  if (fromVersion === toVersion) {
    throw new Error("Thesis diff requires two distinct versions.")
  }

  const fromRevision = findRevision(record, fromVersion)
  const toRevision = findRevision(record, toVersion)
  const watchpoints = diffStringArrays(fromRevision.watchpoints, toRevision.watchpoints)
  const evidence = diffEvidence(fromRevision.evidence, toRevision.evidence)
  const valuationFrom = fromRevision.valuation
    ? {
        valuationCaseId: fromRevision.valuation.valuationCaseId,
        signal: fromRevision.valuation.signal,
        fairValue: fromRevision.valuation.fairValue,
        currentPrice: fromRevision.valuation.currentPrice,
        upsidePercent: fromRevision.valuation.upsidePercent,
      }
    : null
  const valuationTo = toRevision.valuation
    ? {
        valuationCaseId: toRevision.valuation.valuationCaseId,
        signal: toRevision.valuation.signal,
        fairValue: toRevision.valuation.fairValue,
        currentPrice: toRevision.valuation.currentPrice,
        upsidePercent: toRevision.valuation.upsidePercent,
      }
    : null
  const confidenceFrom = fromRevision.confidence
    ? {
        ruleVersion: fromRevision.confidence.ruleVersion,
        requestedConviction: fromRevision.confidence.requestedConviction,
        appliedConviction: fromRevision.confidence.appliedConviction,
        maxAllowedConviction: fromRevision.confidence.maxAllowedConviction,
        score: fromRevision.confidence.score,
        evidenceCount: fromRevision.confidence.evidenceCount,
        uniqueTools: fromRevision.confidence.uniqueTools,
        reasons: fromRevision.confidence.reasons,
      }
    : null
  const confidenceTo = toRevision.confidence
    ? {
        ruleVersion: toRevision.confidence.ruleVersion,
        requestedConviction: toRevision.confidence.requestedConviction,
        appliedConviction: toRevision.confidence.appliedConviction,
        maxAllowedConviction: toRevision.confidence.maxAllowedConviction,
        score: toRevision.confidence.score,
        evidenceCount: toRevision.confidence.evidenceCount,
        uniqueTools: toRevision.confidence.uniqueTools,
        reasons: toRevision.confidence.reasons,
      }
    : null

  const changedFields = [
    fromRevision.summary !== toRevision.summary ? "summary" : null,
    fromRevision.thesis !== toRevision.thesis ? "thesis" : null,
    fromRevision.conviction !== toRevision.conviction ? "conviction" : null,
    fromRevision.posture !== toRevision.posture ? "posture" : null,
    watchpoints.changed ? "watchpoints" : null,
    evidence.changed ? "evidence" : null,
    JSON.stringify(valuationFrom) !== JSON.stringify(valuationTo) ? "valuation" : null,
    !sameConfidence(fromRevision.confidence, toRevision.confidence) ? "confidence" : null,
  ].filter((field): field is string => Boolean(field))

  const diff: InvestingThesisDiff = {
    thesisKey: record.id,
    symbol: record.symbol,
    fromRevision: {
      id: fromRevision.id,
      version: fromRevision.version,
      createdAt: fromRevision.createdAt,
      changeType: fromRevision.changeType,
      summary: fromRevision.summary,
      conviction: fromRevision.conviction,
      posture: fromRevision.posture,
    },
    toRevision: {
      id: toRevision.id,
      version: toRevision.version,
      createdAt: toRevision.createdAt,
      changeType: toRevision.changeType,
      summary: toRevision.summary,
      conviction: toRevision.conviction,
      posture: toRevision.posture,
    },
    changedFields,
    summary: `${record.symbol} thesis diff v${fromVersion} -> v${toVersion} changed ${
      changedFields.length
    } field(s): ${changedFields.join(", ") || "none"}.`,
    changes: {
      summary: {
        from: fromRevision.summary,
        to: toRevision.summary,
        changed: fromRevision.summary !== toRevision.summary,
      },
      thesis: { from: fromRevision.thesis, to: toRevision.thesis, changed: fromRevision.thesis !== toRevision.thesis },
      conviction: {
        from: fromRevision.conviction,
        to: toRevision.conviction,
        changed: fromRevision.conviction !== toRevision.conviction,
      },
      posture: {
        from: fromRevision.posture,
        to: toRevision.posture,
        changed: fromRevision.posture !== toRevision.posture,
      },
      watchpoints,
      evidence,
      valuation: {
        from: valuationFrom,
        to: valuationTo,
        changed: JSON.stringify(valuationFrom) !== JSON.stringify(valuationTo),
      },
      confidence: {
        from: confidenceFrom,
        to: confidenceTo,
        changed: !sameConfidence(fromRevision.confidence, toRevision.confidence),
      },
    },
  }

  recordQueryTelemetry({
    kind: "investing.thesis.query",
    traceID: thesisKey,
    method: "diff",
    path: record.symbol,
    route: thesisKey,
    metadata: { fromVersion, toVersion, changedFields, changeCount: changedFields.length },
  })

  return diff
}

export function buildInvestingThesisPortfolioRollup(input?: {
  audience?: InvestingThesisPortfolioRollupAudience
  posture?: InvestingThesisPosture
  conviction?: InvestingThesisConviction
  limit?: number
  portfolioFile?: string
  watchlistFile?: string
  watchlistSymbols?: string[]
}): InvestingThesisPortfolioRollup {
  const audience = input?.audience ?? "all"
  const holdings = loadPortfolioPositions(input?.portfolioFile)
  const watchlist = loadWatchlistEntries({
    watchlistFile: input?.watchlistFile,
    watchlistSymbols: input?.watchlistSymbols,
  })

  const rawEntries: InvestingThesisPortfolioRollupEntry[] = [
    ...holdings.map((position) => {
      const record = getInvestingThesis(thesisKeyForSymbol(position.symbol))
      const latestRevision = record?.revisions[0]
      return {
        symbol: position.symbol,
        audience: "holding" as const,
        shares: position.shares,
        averageCost: position.averageCost,
        thesis: record
          ? {
              thesisKey: record.id,
              status: record.status,
              summary: record.summary,
              conviction: record.conviction,
              posture: record.posture,
              currentVersion: record.currentVersion,
              updatedAt: record.updatedAt,
              confidence: record.confidence,
            }
          : null,
        latestRevision: latestRevision
          ? {
              revisionId: latestRevision.id,
              version: latestRevision.version,
              changeType: latestRevision.changeType,
              createdAt: latestRevision.createdAt,
              summary: latestRevision.summary,
              evidenceCount: latestRevision.evidence.length,
            }
          : null,
        watchpoints: record?.watchpoints ?? [],
        valuation: record?.valuation ?? null,
      }
    }),
    ...watchlist.map((entry) => {
      const record = getInvestingThesis(thesisKeyForSymbol(entry.symbol))
      const latestRevision = record?.revisions[0]
      return {
        symbol: entry.symbol,
        audience: "watchlist" as const,
        thesis: record
          ? {
              thesisKey: record.id,
              status: record.status,
              summary: record.summary,
              conviction: record.conviction,
              posture: record.posture,
              currentVersion: record.currentVersion,
              updatedAt: record.updatedAt,
              confidence: record.confidence,
            }
          : null,
        latestRevision: latestRevision
          ? {
              revisionId: latestRevision.id,
              version: latestRevision.version,
              changeType: latestRevision.changeType,
              createdAt: latestRevision.createdAt,
              summary: latestRevision.summary,
              evidenceCount: latestRevision.evidence.length,
            }
          : null,
        watchpoints: record?.watchpoints ?? [],
        valuation: record?.valuation ?? null,
      }
    }),
  ]

  const filteredEntries = rawEntries
    .filter((entry) => (audience === "all" ? true : entry.audience === audience))
    .filter((entry) => (input?.posture ? entry.thesis?.posture === input.posture : true))
    .filter((entry) => (input?.conviction ? entry.thesis?.conviction === input.conviction : true))
    .sort(sortRollupEntries)
    .slice(0, input?.limit ?? 50)

  const countsByPosture = withDefaultCounts(INVESTING_THESIS_POSTURES)
  const countsByConviction = withDefaultCounts(INVESTING_THESIS_CONVICTIONS)
  for (const entry of filteredEntries) {
    if (!entry.thesis) continue
    countsByPosture[entry.thesis.posture] += 1
    countsByConviction[entry.thesis.conviction] += 1
  }

  const tracked = filteredEntries.filter((entry) => entry.thesis)
  const missing = filteredEntries.filter((entry) => !entry.thesis)
  const rollup: InvestingThesisPortfolioRollup = {
    schemaVersion: "investing-thesis-rollup.v1",
    createdAt: new Date().toISOString(),
    audience,
    summary: `Portfolio thesis rollup covers ${filteredEntries.filter((entry) => entry.audience === "holding").length} holding(s) and ${filteredEntries.filter((entry) => entry.audience === "watchlist").length} watchlist name(s), with ${tracked.length} tracked thesis record(s) and ${missing.length} missing thesis gap(s).`,
    coverage: {
      holdingsCount: filteredEntries.filter((entry) => entry.audience === "holding").length,
      watchlistCount: filteredEntries.filter((entry) => entry.audience === "watchlist").length,
      thesisTrackedCount: tracked.length,
      missingThesisCount: missing.length,
    },
    countsByPosture,
    countsByConviction,
    entries: filteredEntries,
  }

  recordQueryTelemetry({
    kind: "investing.thesis.rollup",
    traceID: `portfolio-rollup:${audience}`,
    method: "build",
    path: audience,
    route: "investing:thesis:rollup",
    metadata: {
      holdingsCount: rollup.coverage.holdingsCount,
      watchlistCount: rollup.coverage.watchlistCount,
      thesisTrackedCount: rollup.coverage.thesisTrackedCount,
      missingThesisCount: rollup.coverage.missingThesisCount,
      posture: input?.posture,
      conviction: input?.conviction,
      limit: input?.limit ?? 50,
    },
  })

  return rollup
}
