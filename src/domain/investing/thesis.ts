/**
 * Investing Thesis Ledger
 *
 * Persists thesis records, valuation-linked context, and a versioned revision
 * log so later operator and portfolio flows can diff thesis state safely.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FluxRecorder } from "../../../packages/zee/src/flux";
import { Log } from "../../../packages/zee/src/util/log";
import type { InvestingValuationThesisContext } from "./valuation";

const log = Log.create({ service: "investing:thesis" });

export const INVESTING_THESIS_RECORD_STATUSES = ["active", "invalidated", "archived"] as const;
export type InvestingThesisRecordStatus = (typeof INVESTING_THESIS_RECORD_STATUSES)[number];

export const INVESTING_THESIS_CONVICTIONS = ["low", "medium", "high"] as const;
export type InvestingThesisConviction = (typeof INVESTING_THESIS_CONVICTIONS)[number];

export const INVESTING_THESIS_POSTURES = ["bullish", "neutral", "bearish"] as const;
export type InvestingThesisPosture = (typeof INVESTING_THESIS_POSTURES)[number];

export const INVESTING_THESIS_CHANGE_TYPES = ["initialize", "refresh", "valuation-sync", "operator-update"] as const;
export type InvestingThesisChangeType = (typeof INVESTING_THESIS_CHANGE_TYPES)[number];

export interface InvestingThesisValuationSnapshot {
  valuationCaseId?: string;
  packetId?: string;
  runId?: string;
  signal?: InvestingValuationThesisContext["signal"];
  fairValue?: number | null;
  currentPrice?: number | null;
  upsidePercent?: number | null;
}

export interface InvestingThesisEvidenceReference {
  kind: "research-evidence" | "valuation-packet";
  id: string;
  label: string;
  link?: string;
}

export interface InvestingThesisRevision {
  id: string;
  version: number;
  changeType: InvestingThesisChangeType;
  createdAt: string;
  summary: string;
  thesis: string;
  conviction: InvestingThesisConviction;
  posture: InvestingThesisPosture;
  watchpoints: string[];
  valuation: InvestingThesisValuationSnapshot | null;
  evidence: InvestingThesisEvidenceReference[];
  source: {
    workflow?: string;
    planId?: string;
    taskId?: string;
    executionId?: string;
    artifactId?: string;
  };
}

export interface InvestingThesisRecord {
  id: string;
  schemaVersion: "investing-thesis.v1";
  symbol: string;
  createdAt: string;
  updatedAt: string;
  status: InvestingThesisRecordStatus;
  conviction: InvestingThesisConviction;
  posture: InvestingThesisPosture;
  currentVersion: number;
  latestRevisionId?: string;
  summary: string;
  thesis: string;
  watchpoints: string[];
  valuation: InvestingThesisValuationSnapshot | null;
  revisions: InvestingThesisRevision[];
}

type ThesisState = {
  version: 1;
  updatedAt: number;
  records: InvestingThesisRecord[];
};

export type InvestingThesisLedgerStatus = {
  version: 1;
  updatedAt: number;
  totalTheses: number;
  totalRevisions: number;
  countsByStatus: Record<InvestingThesisRecordStatus, number>;
  countsByConviction: Record<InvestingThesisConviction, number>;
};

type SyncInvestingThesisContextInput = {
  thesisKey: string;
  symbol: string;
  summary: string;
  status?: InvestingThesisRecordStatus;
  conviction?: InvestingThesisConviction;
  posture?: InvestingThesisPosture;
  valuation?: InvestingThesisValuationSnapshot | null;
};

type RecordInvestingThesisRevisionInput = {
  thesisKey: string;
  symbol: string;
  changeType: InvestingThesisChangeType;
  summary: string;
  thesis: string;
  status?: InvestingThesisRecordStatus;
  conviction?: InvestingThesisConviction;
  posture?: InvestingThesisPosture;
  watchpoints?: string[];
  valuation?: InvestingThesisValuationSnapshot | null;
  evidence?: InvestingThesisEvidenceReference[];
  source?: InvestingThesisRevision["source"];
};

type ThesisExecutionEvidence = {
  id: string;
  citation: string;
  link: string;
  toolId: string;
  sourceLabel: string;
  status: "completed" | "error";
  data?: unknown;
};

type RecordInvestingThesisRevisionFromExecutionInput = {
  plan: {
    id: string;
    workflow: string;
    objective: string;
    symbols: string[];
  };
  task: {
    id: string;
    title: string;
  };
  execution: {
    id: string;
    synthesis: string;
    artifactId?: string;
    evidence: ThesisExecutionEvidence[];
  };
};

export interface InvestingThesisDraft {
  thesisKey: string;
  symbol: string;
  summary: string;
  conviction: InvestingThesisConviction;
  posture: InvestingThesisPosture;
  watchpoints: string[];
  valuation: InvestingThesisValuationSnapshot | null;
}

function getThesisStateDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee");
  return path.join(stateDir, "investing");
}

export function getInvestingThesisStateFile(): string {
  return path.join(getThesisStateDir(), "theses.json");
}

function ensureThesisStateDir(): void {
  mkdirSync(getThesisStateDir(), { recursive: true });
}

function readThesisState(): ThesisState {
  const filePath = getInvestingThesisStateFile();
  if (!existsSync(filePath)) {
    return { version: 1, updatedAt: 0, records: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<ThesisState>;
    return {
      version: 1,
      updatedAt: Number(parsed.updatedAt ?? 0),
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch (error) {
    log.warn("failed to read thesis state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { version: 1, updatedAt: 0, records: [] };
  }
}

function writeThesisState(state: ThesisState): void {
  ensureThesisStateDir();
  state.updatedAt = Date.now();
  writeFileSync(getInvestingThesisStateFile(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function thesisKeyForSymbol(symbol: string): string {
  return `thesis:${normalizeSymbol(symbol).toLowerCase()}`;
}

function withDefaultCounts<const T extends readonly string[]>(items: T): Record<T[number], number> {
  return Object.fromEntries(items.map((item) => [item, 0])) as Record<T[number], number>;
}

function finiteNumberOrNull(value: unknown): number | null | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asSignal(value: unknown): InvestingValuationThesisContext["signal"] | undefined {
  return value === "re-rate-up" || value === "re-rate-down" || value === "balanced" ? value : undefined;
}

function postureFromSignal(signal?: InvestingValuationThesisContext["signal"]): InvestingThesisPosture {
  switch (signal) {
    case "re-rate-up":
      return "bullish";
    case "re-rate-down":
      return "bearish";
    default:
      return "neutral";
  }
}

function defaultWatchpoints(symbol: string, valuation: InvestingThesisValuationSnapshot | null): string[] {
  if (valuation?.upsidePercent != null && valuation.upsidePercent >= 15) {
    return [
      `Validate that ${symbol} can sustain the upside implied by the current valuation case.`,
      `Monitor estimate revisions and news flow for any break in the upside path.`,
    ];
  }
  if (valuation?.upsidePercent != null && valuation.upsidePercent <= -15) {
    return [
      `Check whether the downside implied for ${symbol} is already reflected in current positioning.`,
      `Monitor for estimate cuts, guidance resets, or event-driven deterioration that confirms the bear case.`,
    ];
  }
  return [
    `Refresh the ${symbol} thesis when new filings, event deltas, or valuation inputs materially change the setup.`,
    `Monitor the next evidence refresh for a directional break in the current neutral posture.`,
  ];
}

function buildEmptyRecord(input: {
  thesisKey: string;
  symbol: string;
  summary: string;
  conviction?: InvestingThesisConviction;
  posture?: InvestingThesisPosture;
  status?: InvestingThesisRecordStatus;
  valuation?: InvestingThesisValuationSnapshot | null;
}): InvestingThesisRecord {
  const createdAt = new Date().toISOString();
  return {
    id: input.thesisKey,
    schemaVersion: "investing-thesis.v1",
    symbol: normalizeSymbol(input.symbol),
    createdAt,
    updatedAt: createdAt,
    status: input.status ?? "active",
    conviction: input.conviction ?? "medium",
    posture: input.posture ?? postureFromSignal(input.valuation?.signal),
    currentVersion: 0,
    summary: input.summary,
    thesis: input.summary,
    watchpoints: defaultWatchpoints(input.symbol, input.valuation ?? null),
    valuation: input.valuation ?? null,
    revisions: [],
  };
}

function valuationSnapshotFromEvidence(evidence: ThesisExecutionEvidence[]): InvestingThesisValuationSnapshot | null {
  for (const item of evidence) {
    if (item.toolId !== "zee:invest-valuation" || item.status !== "completed") continue;
    const data = asRecord(item.data);
    if (!data) continue;
    const thesisContext = asRecord(data.thesisContext);
    return {
      valuationCaseId: typeof data.valuationCaseId === "string" ? data.valuationCaseId : undefined,
      packetId: typeof data.packetId === "string" ? data.packetId : undefined,
      runId: typeof data.id === "string" ? data.id : undefined,
      signal: asSignal(thesisContext?.signal),
      fairValue: finiteNumberOrNull(data.blendedFairValue),
      currentPrice: finiteNumberOrNull(data.currentPrice),
      upsidePercent: finiteNumberOrNull(data.upsidePercent),
    };
  }
  return null;
}

function persistRecord(state: ThesisState, record: InvestingThesisRecord): InvestingThesisRecord {
  record.updatedAt = new Date().toISOString();
  state.records = [record, ...state.records.filter((entry) => entry.id !== record.id)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  writeThesisState(state);
  return record;
}

export function buildInvestingThesisDraft(input: {
  symbol: string;
  thesisKey?: string;
  conviction?: InvestingThesisConviction;
  evidence: ThesisExecutionEvidence[];
}): InvestingThesisDraft {
  const symbol = normalizeSymbol(input.symbol);
  const valuation = valuationSnapshotFromEvidence(input.evidence);
  const posture = postureFromSignal(valuation?.signal);
  const conviction = input.conviction ?? "medium";

  const summary = valuation?.signal
    ? `${symbol} thesis remains ${posture} with ${valuation.signal} valuation signal.`
    : `${symbol} thesis refresh captured updated research evidence and monitoring changes.`;

  return {
    thesisKey: input.thesisKey ?? thesisKeyForSymbol(symbol),
    symbol,
    summary,
    conviction,
    posture,
    watchpoints: defaultWatchpoints(symbol, valuation),
    valuation,
  };
}

export function renderInvestingThesisSnapshot(draft: InvestingThesisDraft): string {
  return [
    "Thesis Snapshot:",
    `- thesisKey=${draft.thesisKey}`,
    `- posture=${draft.posture}`,
    `- conviction=${draft.conviction}`,
    `- valuationSignal=${draft.valuation?.signal ?? "n/a"}`,
    `- valuationCaseId=${draft.valuation?.valuationCaseId ?? "n/a"}`,
    `- watchpoints=${draft.watchpoints.join("; ") || "n/a"}`,
  ].join("\n");
}

export function syncInvestingThesisContext(input: SyncInvestingThesisContextInput): InvestingThesisRecord {
  const state = readThesisState();
  const existing = state.records.find((record) => record.id === input.thesisKey);
  const record = existing
    ? {
        ...existing,
        symbol: normalizeSymbol(input.symbol),
        status: input.status ?? existing.status,
        conviction: input.conviction ?? existing.conviction,
        posture: input.posture ?? existing.posture ?? postureFromSignal(input.valuation?.signal),
        summary: existing.currentVersion > 0 ? existing.summary : input.summary,
        thesis: existing.currentVersion > 0 ? existing.thesis : input.summary,
        watchpoints:
          existing.currentVersion > 0
            ? existing.watchpoints
            : defaultWatchpoints(input.symbol, input.valuation ?? existing.valuation ?? null),
        valuation: input.valuation ?? existing.valuation,
      }
    : buildEmptyRecord({
        thesisKey: input.thesisKey,
        symbol: input.symbol,
        summary: input.summary,
        conviction: input.conviction,
        posture: input.posture,
        status: input.status,
        valuation: input.valuation,
      });

  persistRecord(state, record);

  FluxRecorder.record({
    traceID: record.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.thesis.record",
    status: "ok",
    method: existing ? "update" : "create",
    path: record.symbol,
    route: record.id,
    metadata: {
      schemaVersion: record.schemaVersion,
      currentVersion: record.currentVersion,
      conviction: record.conviction,
      posture: record.posture,
      valuationCaseId: record.valuation?.valuationCaseId,
    },
  });

  return record;
}

export function recordInvestingThesisRevision(input: RecordInvestingThesisRevisionInput): InvestingThesisRecord {
  const state = readThesisState();
  const existing = state.records.find((record) => record.id === input.thesisKey);
  const base =
    existing ??
    buildEmptyRecord({
      thesisKey: input.thesisKey,
      symbol: input.symbol,
      summary: input.summary,
      conviction: input.conviction,
      posture: input.posture,
      status: input.status,
      valuation: input.valuation,
    });

  const version = base.currentVersion + 1;
  const revision: InvestingThesisRevision = {
    id: `thesis-revision-${randomUUID().slice(0, 12)}`,
    version,
    changeType: input.changeType,
    createdAt: new Date().toISOString(),
    summary: input.summary,
    thesis: input.thesis,
    conviction: input.conviction ?? base.conviction,
    posture: input.posture ?? base.posture,
    watchpoints: input.watchpoints ?? base.watchpoints,
    valuation: input.valuation ?? base.valuation,
    evidence: input.evidence ?? [],
    source: input.source ?? {},
  };

  const record: InvestingThesisRecord = {
    ...base,
    symbol: normalizeSymbol(input.symbol),
    status: input.status ?? base.status,
    conviction: revision.conviction,
    posture: revision.posture,
    currentVersion: version,
    latestRevisionId: revision.id,
    summary: revision.summary,
    thesis: revision.thesis,
    watchpoints: revision.watchpoints,
    valuation: revision.valuation,
    revisions: [...base.revisions.filter((entry) => entry.id !== revision.id), revision].sort((a, b) => b.version - a.version),
  };

  persistRecord(state, record);

  FluxRecorder.record({
    traceID: revision.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.thesis.revision",
    status: "ok",
    method: input.changeType,
    path: record.symbol,
    route: record.id,
    metadata: {
      version: revision.version,
      conviction: revision.conviction,
      posture: revision.posture,
      workflow: revision.source.workflow,
      planId: revision.source.planId,
      taskId: revision.source.taskId,
      executionId: revision.source.executionId,
      artifactId: revision.source.artifactId,
      valuationCaseId: revision.valuation?.valuationCaseId,
      evidenceCount: revision.evidence.length,
    },
  });

  FluxRecorder.record({
    traceID: record.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.thesis.record",
    status: "ok",
    method: "revision",
    path: record.symbol,
    route: record.id,
    metadata: {
      currentVersion: record.currentVersion,
      conviction: record.conviction,
      posture: record.posture,
      latestRevisionId: record.latestRevisionId,
      valuationCaseId: record.valuation?.valuationCaseId,
    },
  });

  return record;
}

export function recordInvestingThesisRevisionFromExecution(
  input: RecordInvestingThesisRevisionFromExecutionInput,
): InvestingThesisRecord {
  const symbol = normalizeSymbol(input.plan.symbols[0] ?? "");
  if (!symbol) {
    throw new Error("A symbol is required to record a thesis revision.");
  }

  const thesisKey = thesisKeyForSymbol(symbol);
  const existing = getInvestingThesis(thesisKey);
  const draft = buildInvestingThesisDraft({
    symbol,
    thesisKey,
    conviction: existing?.conviction,
    evidence: input.execution.evidence,
  });

  const evidence = input.execution.evidence
    .filter((item) => item.status === "completed")
    .map<InvestingThesisEvidenceReference>((item) => ({
      kind: "research-evidence",
      id: item.id,
      label: `[${item.citation}] ${item.sourceLabel}`,
      link: item.link,
    }));

  if (draft.valuation?.packetId) {
    evidence.push({
      kind: "valuation-packet",
      id: draft.valuation.packetId,
      label: `Valuation packet for ${symbol}`,
      link: `valuation-packet:${draft.valuation.packetId}`,
    });
  }

  const thesis = [
    draft.summary,
    "",
    `Objective: ${input.plan.objective}`,
    `Workflow: ${input.plan.workflow}`,
    `Task: ${input.task.title}`,
    `Posture: ${draft.posture}`,
    `Conviction: ${draft.conviction}`,
    `Valuation case: ${draft.valuation?.valuationCaseId ?? "n/a"}`,
    `Valuation signal: ${draft.valuation?.signal ?? "n/a"}`,
    "",
    "Watchpoints:",
    ...(draft.watchpoints.length > 0 ? draft.watchpoints.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Execution Synthesis:",
    input.execution.synthesis,
  ].join("\n");

  return recordInvestingThesisRevision({
    thesisKey,
    symbol,
    changeType: existing ? "refresh" : "initialize",
    summary: draft.summary,
    thesis,
    conviction: draft.conviction,
    posture: draft.posture,
    watchpoints: draft.watchpoints,
    valuation: draft.valuation,
    evidence,
    source: {
      workflow: input.plan.workflow,
      planId: input.plan.id,
      taskId: input.task.id,
      executionId: input.execution.id,
      artifactId: input.execution.artifactId,
    },
  });
}

export function getInvestingThesis(thesisKey: string): InvestingThesisRecord | null {
  const state = readThesisState();
  return state.records.find((record) => record.id === thesisKey) ?? null;
}

export function listInvestingTheses(options?: {
  symbol?: string;
  status?: InvestingThesisRecordStatus;
  limit?: number;
}): InvestingThesisRecord[] {
  const normalizedSymbol = options?.symbol ? normalizeSymbol(options.symbol) : undefined;
  const state = readThesisState();
  return state.records
    .filter((record) => (normalizedSymbol ? record.symbol === normalizedSymbol : true))
    .filter((record) => (options?.status ? record.status === options.status : true))
    .slice(0, options?.limit ?? 20);
}

export function getInvestingThesisLedgerStatus(): InvestingThesisLedgerStatus {
  const state = readThesisState();
  const countsByStatus = withDefaultCounts(INVESTING_THESIS_RECORD_STATUSES);
  const countsByConviction = withDefaultCounts(INVESTING_THESIS_CONVICTIONS);
  let totalRevisions = 0;

  for (const record of state.records) {
    countsByStatus[record.status] += 1;
    countsByConviction[record.conviction] += 1;
    totalRevisions += record.revisions.length;
  }

  return {
    version: 1,
    updatedAt: state.updatedAt,
    totalTheses: state.records.length,
    totalRevisions,
    countsByStatus,
    countsByConviction,
  };
}
