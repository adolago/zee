/**
 * Investing Valuation Packets
 *
 * Standardizes export-ready valuation packets for downstream portfolio and
 * research operations consumers.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FluxRecorder } from "../../../packages/zee/src/flux";
import { Log } from "../../../packages/zee/src/util/log";
import { Investing } from "../../paths";
import { syncInvestingThesisContext } from "./thesis";
import type {
  InvestingValuationKernelRun,
  InvestingValuationMethodResult,
  InvestingValuationAssumption,
  InvestingValuationSensitivityTable,
  InvestingValuationThesisContext,
} from "./valuation";

const log = Log.create({ service: "investing:valuation-packets" });

type PortfolioPosition = {
  symbol: string;
  shares: number;
  averageCost: number;
};

export interface InvestingValuationPacket {
  id: string;
  schemaVersion: "valuation-packet.v1";
  runId: string;
  valuationCaseId: string;
  symbol: string;
  createdAt: string;
  summary: string;
  verdict: {
    fairValue: number | null;
    currentPrice: number | null;
    upsidePercent: number | null;
    signal: InvestingValuationThesisContext["signal"];
  };
  portfolioContext: {
    positionStatus: "holding" | "unclassified";
    shares?: number;
    averageCost?: number;
  };
  operationsContext: {
    consumer: "portfolio-ops";
    audience: "holdings" | "general";
    auditKey: string;
  };
  methods: InvestingValuationMethodResult[];
  assumptionProvenance: InvestingValuationAssumption[];
  sensitivityTables: InvestingValuationSensitivityTable[];
  thesisContext: InvestingValuationThesisContext;
  audit: {
    generatedAt: string;
    lastExportedAt?: string;
    exportCount: number;
  };
}

type PacketState = {
  version: 1;
  packets: InvestingValuationPacket[];
};

type CreateInvestingValuationPacketInput = {
  run: InvestingValuationKernelRun;
  overwrite?: boolean;
};

type ExportFormat = "json" | "markdown";

function getPacketStateDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee");
  return path.join(stateDir, "investing");
}

export function getInvestingValuationPacketStateFile(): string {
  return path.join(getPacketStateDir(), "valuation-packets.json");
}

function ensurePacketStateDir(): void {
  mkdirSync(getPacketStateDir(), { recursive: true });
}

function readPacketState(): PacketState {
  const filePath = getInvestingValuationPacketStateFile();
  if (!existsSync(filePath)) {
    return { version: 1, packets: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as PacketState;
    return {
      version: 1,
      packets: Array.isArray(parsed.packets) ? parsed.packets : [],
    };
  } catch (error) {
    log.warn("failed to read valuation packet state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { version: 1, packets: [] };
  }
}

function writePacketState(state: PacketState): void {
  ensurePacketStateDir();
  writeFileSync(getInvestingValuationPacketStateFile(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function loadPortfolioHoldings(): PortfolioPosition[] {
  const portfolioFile = Investing.portfolioFile();
  if (!existsSync(portfolioFile)) return [];

  try {
    const parsed = JSON.parse(readFileSync(portfolioFile, "utf8")) as any;
    const positions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.positions)
        ? parsed.positions
        : [];

    return positions
      .map((position: any): PortfolioPosition | null => {
        const symbol = typeof position?.symbol === "string" ? normalizeSymbol(position.symbol) : "";
        const shares = Number(position?.shares ?? 0);
        const averageCost = Number(
          position?.averageCost ??
            position?.average_cost ??
            position?.avg_cost ??
            position?.entryPrice ??
            position?.entry_price ??
            position?.price ??
            0,
        );
        if (!symbol || !Number.isFinite(shares) || shares <= 0) return null;
        return { symbol, shares, averageCost };
      })
      .filter((position: PortfolioPosition | null): position is PortfolioPosition => Boolean(position));
  } catch {
    return [];
  }
}

function buildPortfolioContext(symbol: string): InvestingValuationPacket["portfolioContext"] {
  const position = loadPortfolioHoldings().find((entry) => entry.symbol === normalizeSymbol(symbol));
  if (!position) {
    return { positionStatus: "unclassified" };
  }

  return {
    positionStatus: "holding",
    shares: position.shares,
    averageCost: position.averageCost,
  };
}

function buildOperationsContext(packet: {
  symbol: string;
  portfolioContext: InvestingValuationPacket["portfolioContext"];
  createdAt: string;
}): InvestingValuationPacket["operationsContext"] {
  return {
    consumer: "portfolio-ops",
    audience: packet.portfolioContext.positionStatus === "holding" ? "holdings" : "general",
    auditKey: `portfolio-ops:${packet.symbol}:${packet.createdAt}`,
  };
}

function renderPacketMarkdown(packet: InvestingValuationPacket): string {
  const methodLines = packet.methods
    .map((method) => `- ${method.method}: ${method.summary}`)
    .join("\n");
  const sensitivityLines = packet.sensitivityTables
    .map((table) => `- ${table.title}: ${table.rows.length} row(s)`)
    .join("\n");

  return [
    `# Valuation Packet: ${packet.symbol}`,
    "",
    `- Case: ${packet.valuationCaseId}`,
    `- Summary: ${packet.summary}`,
    `- Signal: ${packet.verdict.signal}`,
    `- Current price: ${packet.verdict.currentPrice ?? "n/a"}`,
    `- Fair value: ${packet.verdict.fairValue ?? "n/a"}`,
    `- Upside: ${packet.verdict.upsidePercent ?? "n/a"}`,
    "",
    "## Methods",
    methodLines || "- none",
    "",
    "## Sensitivity",
    sensitivityLines || "- none",
    "",
    "## Ops Context",
    `- Audience: ${packet.operationsContext.audience}`,
    `- Audit key: ${packet.operationsContext.auditKey}`,
  ].join("\n");
}

export function findInvestingValuationPacketByRun(runId: string): InvestingValuationPacket | null {
  const state = readPacketState();
  return state.packets.find((packet) => packet.runId === runId) ?? null;
}

export function createInvestingValuationPacket(
  input: CreateInvestingValuationPacketInput,
): InvestingValuationPacket {
  const state = readPacketState();
  const existing = state.packets.find((packet) => packet.runId === input.run.id);
  if (existing && !input.overwrite) {
    return existing;
  }

  const createdAt = new Date().toISOString();
  const portfolioContext = buildPortfolioContext(input.run.symbol);
  const packet: InvestingValuationPacket = {
    id: existing?.id ?? `valuation-packet-${randomUUID().slice(0, 12)}`,
    schemaVersion: "valuation-packet.v1",
    runId: input.run.id,
    valuationCaseId: input.run.valuationCaseId,
    symbol: input.run.symbol,
    createdAt: existing?.createdAt ?? createdAt,
    summary: input.run.summary,
    verdict: {
      fairValue: input.run.blendedFairValue,
      currentPrice: input.run.currentPrice,
      upsidePercent: input.run.upsidePercent,
      signal: input.run.thesisContext.signal,
    },
    portfolioContext,
    operationsContext: buildOperationsContext({
      symbol: input.run.symbol,
      portfolioContext,
      createdAt,
    }),
    methods: input.run.methods,
    assumptionProvenance: input.run.assumptionProvenance,
    sensitivityTables: input.run.sensitivityTables,
    thesisContext: input.run.thesisContext,
    audit: {
      generatedAt: existing?.audit.generatedAt ?? createdAt,
      lastExportedAt: existing?.audit.lastExportedAt,
      exportCount: existing?.audit.exportCount ?? 0,
    },
  };

  state.packets = [packet, ...state.packets.filter((entry) => entry.id !== packet.id)].slice(0, 300);
  writePacketState(state);

  FluxRecorder.record({
    traceID: packet.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.valuation.packet",
    status: "ok",
    method: existing ? "update" : "create",
    path: packet.symbol,
    route: packet.id,
    metadata: {
      runId: packet.runId,
      valuationCaseId: packet.valuationCaseId,
      audience: packet.operationsContext.audience,
      schemaVersion: packet.schemaVersion,
    },
  });

  try {
    syncInvestingThesisContext({
      thesisKey: packet.thesisContext.thesisKey,
      symbol: packet.symbol,
      summary: packet.summary,
      valuation: {
        valuationCaseId: packet.valuationCaseId,
        packetId: packet.id,
        runId: packet.runId,
        signal: packet.thesisContext.signal,
        fairValue: packet.verdict.fairValue,
        currentPrice: packet.verdict.currentPrice,
        upsidePercent: packet.verdict.upsidePercent,
      },
    });
  } catch (error) {
    log.warn("failed to sync thesis context from valuation packet", {
      packetId: packet.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return packet;
}

export function getInvestingValuationPacket(packetId: string): InvestingValuationPacket | null {
  const state = readPacketState();
  return state.packets.find((packet) => packet.id === packetId) ?? null;
}

export function listInvestingValuationPackets(options?: {
  symbol?: string;
  runId?: string;
  limit?: number;
}): InvestingValuationPacket[] {
  const normalizedSymbol = options?.symbol ? normalizeSymbol(options.symbol) : undefined;
  const state = readPacketState();
  return state.packets
    .filter((packet) => (normalizedSymbol ? packet.symbol === normalizedSymbol : true))
    .filter((packet) => (options?.runId ? packet.runId === options.runId : true))
    .slice(0, options?.limit ?? 20);
}

export function exportInvestingValuationPacket(input: {
  packetId: string;
  format: ExportFormat;
}): { packet: InvestingValuationPacket; content: string } {
  const state = readPacketState();
  const packet = state.packets.find((entry) => entry.id === input.packetId);
  if (!packet) {
    throw new Error(`Valuation packet not found: ${input.packetId}`);
  }

  packet.audit.exportCount += 1;
  packet.audit.lastExportedAt = new Date().toISOString();
  writePacketState(state);

  FluxRecorder.record({
    traceID: packet.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.valuation.packet.export",
    status: "ok",
    method: "export",
    path: input.format,
    route: packet.id,
    metadata: {
      runId: packet.runId,
      valuationCaseId: packet.valuationCaseId,
      exportCount: packet.audit.exportCount,
    },
  });

  return {
    packet,
    content: input.format === "markdown" ? renderPacketMarkdown(packet) : JSON.stringify(packet, null, 2),
  };
}
