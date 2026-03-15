/**
 * Investing Portfolio Briefings
 *
 * Builds and persists daily portfolio-ops briefings that summarize holdings
 * and watchlist deltas from thesis state and event-intelligence outputs.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FluxRecorder } from "../../../packages/zee/src/flux";
import {
  buildInvestingEventDeltaBrief,
  type InvestingEventDeltaBrief,
  type InvestingEventDeltaItem,
} from "../../../packages/zee/src/investing/briefing-deltas";
import { Log } from "../../../packages/zee/src/util/log";
import { Investing } from "../../paths";
import {
  getInvestingThesis,
  thesisKeyForSymbol,
  type InvestingThesisConfidenceAssessment,
  type InvestingThesisConviction,
  type InvestingThesisPosture,
  type InvestingThesisValuationSnapshot,
} from "./thesis";

const log = Log.create({ service: "investing:portfolio-briefings" });

export const INVESTING_PORTFOLIO_BRIEFING_KINDS = ["daily-portfolio-brief"] as const;
export type InvestingPortfolioBriefingKind = (typeof INVESTING_PORTFOLIO_BRIEFING_KINDS)[number];

export type InvestingPortfolioBriefingAudience = "holding" | "watchlist";

export interface InvestingPortfolioBriefingSection {
  id: string;
  title: string;
  body: string;
}

export interface InvestingPortfolioBriefingSymbol {
  symbol: string;
  audience: InvestingPortfolioBriefingAudience;
  shares?: number;
  averageCost?: number;
  thesis: null | {
    thesisKey: string;
    summary: string;
    conviction: InvestingThesisConviction;
    posture: InvestingThesisPosture;
    currentVersion: number;
    confidence: InvestingThesisConfidenceAssessment | null;
  };
  valuation: InvestingThesisValuationSnapshot | null;
  eventDeltas: InvestingEventDeltaItem[];
}

export interface InvestingPortfolioBriefing {
  id: string;
  schemaVersion: "portfolio-brief.v1";
  kind: InvestingPortfolioBriefingKind;
  createdAt: string;
  summary: string;
  coverage: {
    holdingsCount: number;
    watchlistCount: number;
    thesisTrackedCount: number;
    eventDeltaCount: number;
  };
  symbols: InvestingPortfolioBriefingSymbol[];
  sections: InvestingPortfolioBriefingSection[];
}

type PortfolioBriefingState = {
  version: 1;
  briefings: InvestingPortfolioBriefing[];
};

type PortfolioPosition = {
  symbol: string;
  shares: number;
  averageCost?: number;
};

type WatchlistEntry = {
  symbol: string;
};

type BuildInvestingPortfolioBriefingInput = {
  watchlistSymbols?: string[];
  portfolioFile?: string;
  watchlistFile?: string;
  createdAt?: string;
  id?: string;
};

function getBriefingStateDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee");
  return path.join(stateDir, "investing");
}

export function getInvestingPortfolioBriefingStateFile(): string {
  return path.join(getBriefingStateDir(), "portfolio-briefings.json");
}

function ensureBriefingStateDir(): void {
  mkdirSync(getBriefingStateDir(), { recursive: true });
}

function readBriefingState(): PortfolioBriefingState {
  const filePath = getInvestingPortfolioBriefingStateFile();
  if (!existsSync(filePath)) {
    return { version: 1, briefings: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<PortfolioBriefingState>;
    return {
      version: 1,
      briefings: Array.isArray(parsed.briefings) ? parsed.briefings : [],
    };
  } catch (error) {
    log.warn("failed to read portfolio briefing state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { version: 1, briefings: [] };
  }
}

function writeBriefingState(state: PortfolioBriefingState): void {
  ensureBriefingStateDir();
  writeFileSync(getInvestingPortfolioBriefingStateFile(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function defaultWatchlistFile(): string {
  return process.env.ZEE_INVESTING_WATCHLIST_FILE || path.join(os.homedir(), ".zee", "investing", "watchlist.json");
}

function normalizeSymbol(symbol: string | undefined): string {
  return symbol?.trim().toUpperCase() ?? "";
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function loadPortfolioPositions(portfolioFile = Investing.portfolioFile()): PortfolioPosition[] {
  const parsed = readJsonFile(portfolioFile);
  const record = asRecord(parsed);
  const positions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.positions)
      ? record.positions
      : Array.isArray(record?.holdings)
        ? record.holdings
        : [];

  return positions
    .map((entry): PortfolioPosition | null => {
      const record = asRecord(entry);
      if (!record) return null;
      const symbol = normalizeSymbol(String(record.symbol ?? record.ticker ?? ""));
      const shares = parseNumber(record.shares ?? record.quantity ?? record.position);
      if (!symbol || !shares || shares <= 0) return null;
      const averageCost = parseNumber(
        record.averageCost ??
          record.average_cost ??
          record.avg_cost ??
          record.entryPrice ??
          record.entry_price ??
          record.price,
      );
      return {
        symbol,
        shares,
        averageCost,
      };
    })
    .filter((entry): entry is PortfolioPosition => Boolean(entry));
}

function loadWatchlistEntries(input: { watchlistSymbols?: string[]; watchlistFile?: string }): WatchlistEntry[] {
  const parsed = readJsonFile(input.watchlistFile ?? defaultWatchlistFile());
  const record = asRecord(parsed);
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.watchlist)
        ? record.watchlist
        : Array.isArray(record?.symbols)
          ? record.symbols
          : [];

  const symbols = [
    ...items.map((item) => {
      if (typeof item === "string") return normalizeSymbol(item);
      const record = asRecord(item);
      return normalizeSymbol(String(record?.symbol ?? record?.ticker ?? record?.code ?? ""));
    }),
    ...(input.watchlistSymbols ?? []).map((symbol) => normalizeSymbol(symbol)),
  ];

  return unique(symbols)
    .filter(Boolean)
    .map((symbol) => ({ symbol }));
}

function summarizeEventDelta(delta: InvestingEventDeltaItem): string {
  return `${delta.materialityBand}/${delta.direction}: ${delta.headline}`;
}

function renderSymbol(entry: InvestingPortfolioBriefingSymbol): string {
  const thesis = entry.thesis
    ? `${entry.thesis.summary} (${entry.thesis.conviction}/${entry.thesis.posture}, v${entry.thesis.currentVersion})`
    : "No thesis record yet.";
  const valuation =
    entry.valuation?.upsidePercent != null
      ? `${entry.valuation.signal ?? "n/a"} @ ${entry.valuation.upsidePercent.toFixed(1)}%`
      : entry.valuation?.signal ?? "n/a";
  const deltas =
    entry.eventDeltas.length > 0 ? entry.eventDeltas.map((item) => summarizeEventDelta(item)).join("; ") : "No high-signal deltas.";
  const position =
    entry.audience === "holding"
      ? ` shares=${entry.shares ?? 0}${entry.averageCost != null ? ` avgCost=${entry.averageCost}` : ""}`
      : "";
  return `- ${entry.symbol} [${entry.audience}]${position}\n  thesis: ${thesis}\n  valuation: ${valuation}\n  deltas: ${deltas}`;
}

function buildSections(input: {
  holdings: InvestingPortfolioBriefingSymbol[];
  watchlist: InvestingPortfolioBriefingSymbol[];
  eventDeltaBrief: InvestingEventDeltaBrief;
}): InvestingPortfolioBriefingSection[] {
  return [
    {
      id: "overview",
      title: "Overview",
      body: input.eventDeltaBrief.summary,
    },
    {
      id: "holdings",
      title: "Holdings",
      body: input.holdings.length > 0 ? input.holdings.map((entry) => renderSymbol(entry)).join("\n") : "- none",
    },
    {
      id: "watchlist",
      title: "Watchlist",
      body: input.watchlist.length > 0 ? input.watchlist.map((entry) => renderSymbol(entry)).join("\n") : "- none",
    },
  ];
}

export async function buildInvestingPortfolioBriefing(
  input: BuildInvestingPortfolioBriefingInput = {},
): Promise<InvestingPortfolioBriefing> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const holdings = loadPortfolioPositions(input.portfolioFile);
  const watchlist = loadWatchlistEntries({
    watchlistSymbols: input.watchlistSymbols,
    watchlistFile: input.watchlistFile,
  }).filter((entry) => !holdings.some((position) => position.symbol === entry.symbol));

  const symbols = unique([...holdings.map((entry) => entry.symbol), ...watchlist.map((entry) => entry.symbol)]);
  const eventDeltaBrief = await buildInvestingEventDeltaBrief({
    mode: "daily",
    symbols,
  });
  const deltasBySymbol = new Map<string, InvestingEventDeltaItem[]>();
  for (const item of eventDeltaBrief.items) {
    const symbol = normalizeSymbol(item.symbol);
    if (!symbol) continue;
    const items = deltasBySymbol.get(symbol) ?? [];
    items.push(item);
    deltasBySymbol.set(symbol, items);
  }

  const symbolEntries: InvestingPortfolioBriefingSymbol[] = [
    ...holdings.map((position) => {
      const thesis = getInvestingThesis(thesisKeyForSymbol(position.symbol));
      return {
        symbol: position.symbol,
        audience: "holding" as const,
        shares: position.shares,
        averageCost: position.averageCost,
        thesis: thesis
          ? {
              thesisKey: thesis.id,
              summary: thesis.summary,
              conviction: thesis.conviction,
              posture: thesis.posture,
              currentVersion: thesis.currentVersion,
              confidence: thesis.confidence,
            }
          : null,
        valuation: thesis?.valuation ?? null,
        eventDeltas: deltasBySymbol.get(position.symbol) ?? [],
      };
    }),
    ...watchlist.map((entry) => {
      const thesis = getInvestingThesis(thesisKeyForSymbol(entry.symbol));
      return {
        symbol: entry.symbol,
        audience: "watchlist" as const,
        thesis: thesis
          ? {
              thesisKey: thesis.id,
              summary: thesis.summary,
              conviction: thesis.conviction,
              posture: thesis.posture,
              currentVersion: thesis.currentVersion,
              confidence: thesis.confidence,
            }
          : null,
        valuation: thesis?.valuation ?? null,
        eventDeltas: deltasBySymbol.get(entry.symbol) ?? [],
      };
    }),
  ].sort((left, right) => left.symbol.localeCompare(right.symbol));

  const thesisTrackedCount = symbolEntries.filter((entry) => entry.thesis).length;
  const holdingsEntries = symbolEntries.filter((entry) => entry.audience === "holding");
  const watchlistEntries = symbolEntries.filter((entry) => entry.audience === "watchlist");
  const summary = `Daily portfolio brief covers ${holdingsEntries.length} holding(s) and ${watchlistEntries.length} watchlist name(s), with ${eventDeltaBrief.items.length} high-signal event delta(s) and ${thesisTrackedCount} thesis-backed symbol(s).`;

  return {
    id: input.id ?? `portfolio-brief-${randomUUID().slice(0, 12)}`,
    schemaVersion: "portfolio-brief.v1",
    kind: "daily-portfolio-brief",
    createdAt,
    summary,
    coverage: {
      holdingsCount: holdingsEntries.length,
      watchlistCount: watchlistEntries.length,
      thesisTrackedCount,
      eventDeltaCount: eventDeltaBrief.items.length,
    },
    symbols: symbolEntries,
    sections: buildSections({
      holdings: holdingsEntries,
      watchlist: watchlistEntries,
      eventDeltaBrief,
    }),
  };
}

export function renderInvestingPortfolioBriefing(briefing: InvestingPortfolioBriefing): string {
  return [
    "Portfolio Briefing:",
    briefing.summary,
    "",
    ...briefing.sections.flatMap((section) => [section.title, section.body, ""]),
  ]
    .join("\n")
    .trim();
}

export async function createInvestingPortfolioBriefing(
  input: BuildInvestingPortfolioBriefingInput = {},
): Promise<InvestingPortfolioBriefing> {
  const briefing = await buildInvestingPortfolioBriefing(input);
  const state = readBriefingState();
  state.briefings = [briefing, ...state.briefings.filter((entry) => entry.id !== briefing.id)].slice(0, 300);
  writeBriefingState(state);

  FluxRecorder.record({
    traceID: briefing.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.portfolio.briefing",
    status: "ok",
    method: "create",
    path: briefing.kind,
    route: briefing.id,
    metadata: {
      symbolCount: briefing.symbols.length,
      holdingsCount: briefing.coverage.holdingsCount,
      watchlistCount: briefing.coverage.watchlistCount,
      thesisTrackedCount: briefing.coverage.thesisTrackedCount,
      eventDeltaCount: briefing.coverage.eventDeltaCount,
    },
  });

  return briefing;
}

export function getInvestingPortfolioBriefing(briefingId: string): InvestingPortfolioBriefing | null {
  const state = readBriefingState();
  return state.briefings.find((entry) => entry.id === briefingId) ?? null;
}

export function listInvestingPortfolioBriefings(options?: {
  kind?: InvestingPortfolioBriefingKind;
  symbol?: string;
  audience?: InvestingPortfolioBriefingAudience;
  limit?: number;
}): InvestingPortfolioBriefing[] {
  const normalizedSymbol = options?.symbol ? normalizeSymbol(options.symbol) : undefined;
  const state = readBriefingState();
  return state.briefings
    .filter((entry) => (options?.kind ? entry.kind === options.kind : true))
    .filter((entry) =>
      normalizedSymbol ? entry.symbols.some((symbol) => symbol.symbol === normalizedSymbol) : true,
    )
    .filter((entry) =>
      options?.audience ? entry.symbols.some((symbol) => symbol.audience === options.audience) : true,
    )
    .slice(0, options?.limit ?? 20);
}
