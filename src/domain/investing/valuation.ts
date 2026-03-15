/**
 * Investing Valuation Kernel
 *
 * Produces repeatable valuation runs that combine DCF, comps, and scenario
 * analysis into a stable local contract for future valuation packets.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FluxRecorder } from "../../../packages/zee/src/flux";
import { Log } from "../../../packages/zee/src/util/log";
import { Investing } from "../../paths";
import { createInvestingValuationPacket } from "./valuation-packet";

const log = Log.create({ service: "investing:valuation-kernel" });

export type InvestingValuationKernelStatus = "ok" | "error";
export type InvestingValuationMethodStatus = "ok" | "error";

export interface InvestingValuationMethodResult {
  method: "valuation" | "dcf" | "comparables";
  status: InvestingValuationMethodStatus;
  fairValue: number | null;
  currentPrice: number | null;
  upsidePercent: number | null;
  summary: string;
  data?: unknown;
  error?: string;
}

export interface InvestingValuationScenario {
  name: "bear" | "base" | "bull";
  weight: number;
  multiplier: number;
  fairValue: number | null;
  upsidePercent: number | null;
}

export interface InvestingValuationAssumption {
  id: string;
  valuationCaseId: string;
  method: "valuation" | "dcf" | "comparables" | "scenario";
  name: string;
  value: string | number | boolean | null | string[];
  sourceType: "valuation-api" | "dcf-api" | "comparables" | "scenario-model";
  sourcePath: string;
  sourceLabel: string;
}

export interface InvestingValuationSensitivityRow {
  label: string;
  fairValue: number | null;
  upsidePercent: number | null;
  assumptions: Record<string, unknown>;
}

export interface InvestingValuationSensitivityTable {
  id: string;
  method: "dcf" | "comparables" | "blended";
  title: string;
  rows: InvestingValuationSensitivityRow[];
}

export interface InvestingValuationThesisContext {
  thesisKey: string;
  valuationCaseId: string;
  signal: "re-rate-up" | "re-rate-down" | "balanced";
  linkedMetrics: string[];
}

export interface InvestingValuationKernelRun {
  id: string;
  symbol: string;
  valuationCaseId: string;
  packetId?: string;
  status: InvestingValuationKernelStatus;
  createdAt: string;
  peerSymbols: string[];
  methods: InvestingValuationMethodResult[];
  scenarios: InvestingValuationScenario[];
  blendedFairValue: number | null;
  currentPrice: number | null;
  upsidePercent: number | null;
  assumptions: Record<string, unknown>;
  assumptionProvenance: InvestingValuationAssumption[];
  sensitivityTables: InvestingValuationSensitivityTable[];
  thesisContext: InvestingValuationThesisContext;
  summary: string;
  errors: string[];
}

type ValuationState = {
  version: 1;
  runs: InvestingValuationKernelRun[];
};

type InvestingRequestResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type RunInvestingValuationKernelInput = {
  symbol: string;
  peers?: string[];
  discountRate?: number;
  terminalGrowth?: number;
  projectionYears?: number;
  bearMultiplier?: number;
  bullMultiplier?: number;
};

function getValuationStateDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee");
  return path.join(stateDir, "investing");
}

export function getInvestingValuationKernelStateFile(): string {
  return path.join(getValuationStateDir(), "valuation-kernels.json");
}

function ensureValuationStateDir(): void {
  mkdirSync(getValuationStateDir(), { recursive: true });
}

function readValuationState(): ValuationState {
  const filePath = getInvestingValuationKernelStateFile();
  if (!existsSync(filePath)) {
    return { version: 1, runs: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ValuationState;
    return {
      version: 1,
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch (error) {
    log.warn("failed to read valuation kernel state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { version: 1, runs: [] };
  }
}

function writeValuationState(state: ValuationState): void {
  ensureValuationStateDir();
  writeFileSync(getInvestingValuationKernelStateFile(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizePeers(peers?: string[]): string[] {
  return Array.from(new Set((peers ?? []).map(normalizeSymbol).filter(Boolean)));
}

function buildValuationCaseId(symbol: string, runId: string): string {
  return `valuation_case:equity:${symbol.toLowerCase()}:${runId}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function midpoint(low: unknown, high: unknown): number | null {
  const lowValue = asNumber(low);
  const highValue = asNumber(high);
  if (lowValue == null || highValue == null) return null;
  return (lowValue + highValue) / 2;
}

function computeUpside(fairValue: number | null, currentPrice: number | null): number | null {
  if (fairValue == null || currentPrice == null || currentPrice === 0) return null;
  return ((fairValue - currentPrice) / currentPrice) * 100;
}

function normalizeAssumptionValue(value: unknown): string | number | boolean | null | string[] {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  return JSON.stringify(value);
}

async function requestInvesting(pathname: string): Promise<InvestingRequestResult> {
  try {
    const baseUrl = Investing.apiUrl().replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: { "content-type": "application/json" },
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as { success?: boolean; data?: unknown; error?: string } | unknown) : null;

    if (payload && typeof payload === "object" && "success" in payload && "data" in payload) {
      const envelope = payload as { success: boolean; data: unknown; error?: string };
      if (!response.ok || !envelope.success) {
        return {
          ok: false,
          error: envelope.error || `Investing request failed with status ${response.status}`,
        };
      }
      return { ok: true, data: envelope.data };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: text || `Investing request failed with status ${response.status}`,
      };
    }

    return { ok: true, data: payload };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function valuationMethodResult(result: InvestingRequestResult): InvestingValuationMethodResult {
  if (!result.ok) {
    return {
      method: "valuation",
      status: "error",
      fairValue: null,
      currentPrice: null,
      upsidePercent: null,
      summary: "Valuation overview failed.",
      error: result.error,
    };
  }

  const payload = asRecord(result.data);
  const fairValue = asNumber(payload?.fairValue);
  const currentPrice = asNumber(payload?.currentPrice);
  const upsidePercent = asNumber(payload?.upsidePercent) ?? computeUpside(fairValue, currentPrice);

  return {
    method: "valuation",
    status: "ok",
    fairValue,
    currentPrice,
    upsidePercent,
    summary:
      fairValue != null && currentPrice != null
        ? `Valuation overview points to ${fairValue.toFixed(2)} vs ${currentPrice.toFixed(2)}.`
        : "Valuation overview captured.",
    data: result.data,
  };
}

function dcfMethodResult(result: InvestingRequestResult): InvestingValuationMethodResult {
  if (!result.ok) {
    return {
      method: "dcf",
      status: "error",
      fairValue: null,
      currentPrice: null,
      upsidePercent: null,
      summary: "DCF analysis failed.",
      error: result.error,
    };
  }

  const payload = asRecord(result.data);
  const dcf = asRecord(payload?.dcf);
  const fairValue = asNumber(dcf?.intrinsicValue);
  const currentPrice = asNumber(dcf?.currentPrice);
  const upsidePercent = asNumber(dcf?.upsidePercentage) ?? computeUpside(fairValue, currentPrice);

  return {
    method: "dcf",
    status: "ok",
    fairValue,
    currentPrice,
    upsidePercent,
    summary:
      fairValue != null && currentPrice != null
        ? `DCF intrinsic value is ${fairValue.toFixed(2)} against ${currentPrice.toFixed(2)}.`
        : "DCF analysis captured.",
    data: result.data,
  };
}

function comparablesMethodResult(result: InvestingRequestResult): InvestingValuationMethodResult {
  if (!result.ok) {
    return {
      method: "comparables",
      status: "error",
      fairValue: null,
      currentPrice: null,
      upsidePercent: null,
      summary: "Comparable-company analysis failed.",
      error: result.error,
    };
  }

  const payload = asRecord(result.data);
  const fairValueRange = asRecord(payload?.fairValueRange);
  const fairValue = midpoint(fairValueRange?.low, fairValueRange?.high);
  const target = asRecord(payload?.target);
  const currentPrice = asNumber(target?.currentPrice) ?? asNumber(target?.price);
  const upsidePercent = computeUpside(fairValue, currentPrice);

  return {
    method: "comparables",
    status: "ok",
    fairValue,
    currentPrice,
    upsidePercent,
    summary:
      fairValue != null && currentPrice != null
        ? `Comparable range midpoint is ${fairValue.toFixed(2)} vs ${currentPrice.toFixed(2)}.`
        : "Comparable-company analysis captured.",
    data: result.data,
  };
}

function firstCurrentPrice(methods: InvestingValuationMethodResult[]): number | null {
  return methods.find((method) => method.currentPrice != null)?.currentPrice ?? null;
}

function blendedFairValue(methods: InvestingValuationMethodResult[]): number | null {
  const fairValues = methods.map((method) => method.fairValue).filter((value): value is number => value != null);
  if (fairValues.length === 0) return null;
  return fairValues.reduce((sum, value) => sum + value, 0) / fairValues.length;
}

function buildScenarios(input: {
  fairValue: number | null;
  currentPrice: number | null;
  bearMultiplier: number;
  bullMultiplier: number;
}): InvestingValuationScenario[] {
  const cases: Array<Pick<InvestingValuationScenario, "name" | "weight" | "multiplier">> = [
    { name: "bear", weight: 0.25, multiplier: input.bearMultiplier },
    { name: "base", weight: 0.5, multiplier: 1 },
    { name: "bull", weight: 0.25, multiplier: input.bullMultiplier },
  ];

  return cases.map((scenario) => {
    const fairValue = input.fairValue == null ? null : input.fairValue * scenario.multiplier;
    return {
      ...scenario,
      fairValue,
      upsidePercent: computeUpside(fairValue, input.currentPrice),
    };
  });
}

function assumptionsFromResults(input: {
  valuation: InvestingRequestResult;
  dcf: InvestingRequestResult;
  peers: InvestingRequestResult;
  peersList: string[];
  bearMultiplier: number;
  bullMultiplier: number;
}): Record<string, unknown> {
  const valuationData = asRecord(input.valuation.data);
  const dcfData = asRecord(input.dcf.data);
  const peersData = asRecord(input.peers.data);

  return {
    peers: input.peersList,
    scenario: {
      bearMultiplier: input.bearMultiplier,
      baseMultiplier: 1,
      bullMultiplier: input.bullMultiplier,
    },
    valuation: asRecord(valuationData?.assumptions) ?? {},
    dcf: asRecord(dcfData?.assumptions) ?? {},
    comparables: {
      fairValueRange: asRecord(peersData?.fairValueRange) ?? {},
      requestedPeers: input.peersList,
    },
  };
}

function assumptionEntries(input: {
  valuationCaseId: string;
  method: InvestingValuationAssumption["method"];
  sourceType: InvestingValuationAssumption["sourceType"];
  sourcePathPrefix: string;
  sourceLabel: string;
  record: Record<string, unknown>;
}): InvestingValuationAssumption[] {
  return Object.entries(input.record).map(([name, value]) => ({
    id: `valuation-assumption-${randomUUID().slice(0, 12)}`,
    valuationCaseId: input.valuationCaseId,
    method: input.method,
    name,
    value: normalizeAssumptionValue(value),
    sourceType: input.sourceType,
    sourcePath: `${input.sourcePathPrefix}.${name}`,
    sourceLabel: input.sourceLabel,
  }));
}

function buildAssumptionProvenance(input: {
  valuationCaseId: string;
  symbol: string;
  assumptions: Record<string, unknown>;
}): InvestingValuationAssumption[] {
  const valuation = asRecord(input.assumptions.valuation) ?? {};
  const dcf = asRecord(input.assumptions.dcf) ?? {};
  const comparables = asRecord(input.assumptions.comparables) ?? {};
  const scenario = asRecord(input.assumptions.scenario) ?? {};

  return [
    ...assumptionEntries({
      valuationCaseId: input.valuationCaseId,
      method: "valuation",
      sourceType: "valuation-api",
      sourcePathPrefix: "valuation.assumptions",
      sourceLabel: `${input.symbol} valuation overview`,
      record: valuation,
    }),
    ...assumptionEntries({
      valuationCaseId: input.valuationCaseId,
      method: "dcf",
      sourceType: "dcf-api",
      sourcePathPrefix: "dcf.assumptions",
      sourceLabel: `${input.symbol} DCF`,
      record: dcf,
    }),
    ...assumptionEntries({
      valuationCaseId: input.valuationCaseId,
      method: "comparables",
      sourceType: "comparables",
      sourcePathPrefix: "comparables.assumptions",
      sourceLabel: `${input.symbol} comparables`,
      record: comparables,
    }),
    ...assumptionEntries({
      valuationCaseId: input.valuationCaseId,
      method: "scenario",
      sourceType: "scenario-model",
      sourcePathPrefix: "scenario.assumptions",
      sourceLabel: `${input.symbol} scenario model`,
      record: scenario,
    }),
  ];
}

function buildSensitivityTables(input: {
  valuationCaseId: string;
  methods: InvestingValuationMethodResult[];
  scenarios: InvestingValuationScenario[];
  currentPrice: number | null;
  assumptions: Record<string, unknown>;
}): InvestingValuationSensitivityTable[] {
  const dcfMethod = input.methods.find((method) => method.method === "dcf");
  const compsMethod = input.methods.find((method) => method.method === "comparables");
  const dcfAssumptions = asRecord(input.assumptions.dcf) ?? {};
  const discountRate = asNumber(dcfAssumptions.discountRate) ?? 0.1;
  const terminalGrowth = asNumber(dcfAssumptions.terminalGrowth) ?? 0.03;

  const dcfTable: InvestingValuationSensitivityTable = {
    id: `${input.valuationCaseId}:dcf`,
    method: "dcf",
    title: "DCF discount-rate sensitivity",
    rows: [
      {
        label: "Lower discount rate",
        fairValue: dcfMethod?.fairValue == null ? null : dcfMethod.fairValue * 1.08,
        upsidePercent:
          dcfMethod?.fairValue == null
            ? null
            : computeUpside(dcfMethod.fairValue * 1.08, input.currentPrice),
        assumptions: { discountRate: discountRate - 0.01, terminalGrowth },
      },
      {
        label: "Base discount rate",
        fairValue: dcfMethod?.fairValue ?? null,
        upsidePercent: computeUpside(dcfMethod?.fairValue ?? null, input.currentPrice),
        assumptions: { discountRate, terminalGrowth },
      },
      {
        label: "Higher discount rate",
        fairValue: dcfMethod?.fairValue == null ? null : dcfMethod.fairValue * 0.92,
        upsidePercent:
          dcfMethod?.fairValue == null
            ? null
            : computeUpside(dcfMethod.fairValue * 0.92, input.currentPrice),
        assumptions: { discountRate: discountRate + 0.01, terminalGrowth },
      },
    ],
  };

  const comparablesRange = asRecord(input.assumptions.comparables)?.fairValueRange;
  const comparablesLow = asRecord(comparablesRange)?.low;
  const comparablesHigh = asRecord(comparablesRange)?.high;
  const comparablesMid = compsMethod?.fairValue ?? midpoint(comparablesLow, comparablesHigh);
  const comparablesTable: InvestingValuationSensitivityTable = {
    id: `${input.valuationCaseId}:comparables`,
    method: "comparables",
    title: "Comparable-company range sensitivity",
    rows: [
      {
        label: "Low range",
        fairValue: asNumber(comparablesLow),
        upsidePercent: computeUpside(asNumber(comparablesLow), input.currentPrice),
        assumptions: { rangePosition: "low" },
      },
      {
        label: "Mid range",
        fairValue: comparablesMid,
        upsidePercent: computeUpside(comparablesMid, input.currentPrice),
        assumptions: { rangePosition: "mid" },
      },
      {
        label: "High range",
        fairValue: asNumber(comparablesHigh),
        upsidePercent: computeUpside(asNumber(comparablesHigh), input.currentPrice),
        assumptions: { rangePosition: "high" },
      },
    ],
  };

  const blendedTable: InvestingValuationSensitivityTable = {
    id: `${input.valuationCaseId}:blended`,
    method: "blended",
    title: "Blended valuation scenario surface",
    rows: input.scenarios.map((scenario) => ({
      label: scenario.name,
      fairValue: scenario.fairValue,
      upsidePercent: scenario.upsidePercent,
      assumptions: {
        multiplier: scenario.multiplier,
        weight: scenario.weight,
      },
    })),
  };

  return [dcfTable, comparablesTable, blendedTable];
}

function buildThesisContext(input: {
  symbol: string;
  valuationCaseId: string;
  upsidePercent: number | null;
}): InvestingValuationThesisContext {
  const signal =
    input.upsidePercent == null ? "balanced" : input.upsidePercent >= 15 ? "re-rate-up" : input.upsidePercent <= -15 ? "re-rate-down" : "balanced";

  return {
    thesisKey: `thesis:${input.symbol.toLowerCase()}`,
    valuationCaseId: input.valuationCaseId,
    signal,
    linkedMetrics: ["blendedFairValue", "currentPrice", "upsidePercent"],
  };
}

function buildSummary(input: {
  symbol: string;
  status: InvestingValuationKernelStatus;
  blendedFairValue: number | null;
  currentPrice: number | null;
  upsidePercent: number | null;
  methods: InvestingValuationMethodResult[];
  errors: string[];
}): string {
  if (input.status === "error") {
    return `${input.symbol} valuation kernel failed; ${input.errors.length} method(s) did not return usable valuation data.`;
  }

  const successfulMethods = input.methods.filter((method) => method.status === "ok").length;
  if (input.blendedFairValue != null && input.currentPrice != null) {
    const upsideLabel = input.upsidePercent == null ? "n/a" : `${input.upsidePercent.toFixed(1)}%`;
    return `${input.symbol} blended fair value is ${input.blendedFairValue.toFixed(2)} vs ${input.currentPrice.toFixed(2)} (${upsideLabel}) across ${successfulMethods} method(s).`;
  }

  return `${input.symbol} valuation kernel completed with ${successfulMethods} successful method(s).`;
}

export async function runInvestingValuationKernel(
  input: RunInvestingValuationKernelInput,
): Promise<InvestingValuationKernelRun> {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    throw new Error("A symbol is required for valuation analysis.");
  }

  const peerSymbols = normalizePeers(input.peers);
  const valuationPath = `/api/valuation/${symbol}?include_dcf=true`;
  const dcfParams = new URLSearchParams();
  if (input.discountRate != null) dcfParams.set("discount_rate", String(input.discountRate));
  if (input.terminalGrowth != null) dcfParams.set("terminal_growth", String(input.terminalGrowth));
  if (input.projectionYears != null) dcfParams.set("projection_years", String(input.projectionYears));
  const dcfPath = `/api/research/${symbol}/dcf${dcfParams.toString() ? `?${dcfParams.toString()}` : ""}`;
  const peerPath = `/api/peers/${symbol}${peerSymbols.length > 0 ? `?peers=${encodeURIComponent(peerSymbols.join(","))}` : ""}`;

  const [valuationResponse, dcfResponse, peersResponse] = await Promise.all([
    requestInvesting(valuationPath),
    requestInvesting(dcfPath),
    requestInvesting(peerPath),
  ]);

  const methods = [
    valuationMethodResult(valuationResponse),
    dcfMethodResult(dcfResponse),
    comparablesMethodResult(peersResponse),
  ];

  const currentPrice = firstCurrentPrice(methods);
  const fairValue = blendedFairValue(methods);
  const upsidePercent = computeUpside(fairValue, currentPrice);
  const bearMultiplier = input.bearMultiplier ?? 0.85;
  const bullMultiplier = input.bullMultiplier ?? 1.15;
  const scenarios = buildScenarios({
    fairValue,
    currentPrice,
    bearMultiplier,
    bullMultiplier,
  });

  const errors = methods
    .filter((method) => method.status === "error")
    .map((method) => `${method.method}: ${method.error ?? "unknown error"}`);
  const status: InvestingValuationKernelStatus = methods.some((method) => method.status === "ok") ? "ok" : "error";
  const runId = `valuation-kernel-${randomUUID().slice(0, 12)}`;
  const valuationCaseId = buildValuationCaseId(symbol, runId);
  const assumptions = assumptionsFromResults({
    valuation: valuationResponse,
    dcf: dcfResponse,
    peers: peersResponse,
    peersList: peerSymbols,
    bearMultiplier,
    bullMultiplier,
  });
  const assumptionProvenance = buildAssumptionProvenance({
    valuationCaseId,
    symbol,
    assumptions,
  });
  const sensitivityTables = buildSensitivityTables({
    valuationCaseId,
    methods,
    scenarios,
    currentPrice,
    assumptions,
  });
  const run: InvestingValuationKernelRun = {
    id: runId,
    symbol,
    valuationCaseId,
    status,
    createdAt: new Date().toISOString(),
    peerSymbols,
    methods,
    scenarios,
    blendedFairValue: fairValue,
    currentPrice,
    upsidePercent,
    assumptions,
    assumptionProvenance,
    sensitivityTables,
    thesisContext: buildThesisContext({
      symbol,
      valuationCaseId,
      upsidePercent,
    }),
    summary: buildSummary({
      symbol,
      status,
      blendedFairValue: fairValue,
      currentPrice,
      upsidePercent,
      methods,
      errors,
    }),
    errors,
  };

  const state = readValuationState();
  state.runs = [run, ...state.runs].slice(0, 300);
  writeValuationState(state);

  FluxRecorder.record({
    traceID: run.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.valuation.kernel",
    status: run.status === "ok" ? "ok" : "error",
    method: "run",
    path: run.symbol,
    route: run.id,
    metadata: {
      valuationCaseId: run.valuationCaseId,
      methodCount: run.methods.length,
      successfulMethods: run.methods.filter((method) => method.status === "ok").length,
      scenarioCount: run.scenarios.length,
      blendedFairValue: run.blendedFairValue,
      currentPrice: run.currentPrice,
      upsidePercent: run.upsidePercent,
    },
  });

  for (const method of run.methods) {
    FluxRecorder.record({
      traceID: run.id,
      direction: "internal",
      domain: "investing",
      kind: "investing.valuation.method",
      status: method.status === "ok" ? "ok" : "error",
      method: "collect",
      path: method.method,
      route: run.symbol,
      metadata: {
        symbol: run.symbol,
        valuationCaseId: run.valuationCaseId,
        fairValue: method.fairValue,
        currentPrice: method.currentPrice,
        upsidePercent: method.upsidePercent,
        summary: method.summary,
      },
      error: method.error ? { message: method.error } : undefined,
    });
  }

  for (const scenario of run.scenarios) {
    FluxRecorder.record({
      traceID: run.id,
      direction: "internal",
      domain: "investing",
      kind: "investing.valuation.scenario",
      status: run.status === "ok" ? "ok" : "error",
      method: "model",
      path: scenario.name,
      route: run.symbol,
      metadata: {
        valuationCaseId: run.valuationCaseId,
        fairValue: scenario.fairValue,
        upsidePercent: scenario.upsidePercent,
        multiplier: scenario.multiplier,
        weight: scenario.weight,
      },
    });
  }

  for (const assumption of run.assumptionProvenance) {
    FluxRecorder.record({
      traceID: run.id,
      direction: "internal",
      domain: "investing",
      kind: "investing.valuation.assumption",
      status: "ok",
      method: "trace",
      path: assumption.method,
      route: assumption.id,
      metadata: {
        symbol: run.symbol,
        valuationCaseId: run.valuationCaseId,
        name: assumption.name,
        value: assumption.value,
        sourceType: assumption.sourceType,
        sourcePath: assumption.sourcePath,
      },
    });
  }

  for (const table of run.sensitivityTables) {
    FluxRecorder.record({
      traceID: run.id,
      direction: "internal",
      domain: "investing",
      kind: "investing.valuation.sensitivity",
      status: run.status === "ok" ? "ok" : "error",
      method: "analyze",
      path: table.method,
      route: table.id,
      metadata: {
        symbol: run.symbol,
        valuationCaseId: run.valuationCaseId,
        rowCount: table.rows.length,
        title: table.title,
      },
    });
  }

  try {
    const packet = createInvestingValuationPacket({ run });
    run.packetId = packet.id;
    state.runs = state.runs.map((entry) => (entry.id === run.id ? run : entry));
    writeValuationState(state);
  } catch (error) {
    log.warn("failed to create valuation packet", {
      runId: run.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return run;
}

export function getInvestingValuationKernel(runId: string): InvestingValuationKernelRun | null {
  const state = readValuationState();
  return state.runs.find((run) => run.id === runId) ?? null;
}

export function listInvestingValuationKernels(options?: {
  symbol?: string;
  status?: InvestingValuationKernelStatus;
  limit?: number;
}): InvestingValuationKernelRun[] {
  const normalizedSymbol = options?.symbol ? normalizeSymbol(options.symbol) : undefined;
  const state = readValuationState();
  return state.runs
    .filter((run) => (normalizedSymbol ? run.symbol === normalizedSymbol : true))
    .filter((run) => (options?.status ? run.status === options.status : true))
    .slice(0, options?.limit ?? 20);
}
