/**
 * Investing Earnings Packets
 *
 * Persists pre and post earnings packets tied to catalysts, risks, and
 * valuation changes so portfolio operators can review one stable artifact
 * instead of stitching together event deltas, thesis state, and research
 * outputs by hand.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FluxRecorder } from "../../../packages/zee/src/flux";
import {
  buildInvestingEventDeltaBrief,
  type InvestingEventDeltaItem,
} from "../../../packages/zee/src/investing/briefing-deltas";
import { Log } from "../../../packages/zee/src/util/log";
import {
  getInvestingResearchArtifact,
  type InvestingResearchArtifactDiagnostic,
} from "./artifacts";
import type { InvestingResearchExecution } from "./executor";
import type { InvestingResearchPlan, InvestingResearchTask } from "./planner";
import {
  getInvestingThesis,
  thesisKeyForSymbol,
  type InvestingThesisValuationSnapshot,
} from "./thesis";

const log = Log.create({ service: "investing:earnings-packets" });

export const INVESTING_EARNINGS_PACKET_WORKFLOWS = [
  "earnings-preview",
  "earnings-review",
] as const;

export type InvestingEarningsPacketWorkflow =
  (typeof INVESTING_EARNINGS_PACKET_WORKFLOWS)[number];

export const INVESTING_EARNINGS_PACKET_STATUSES = [
  "ready",
  "degraded",
] as const;

export type InvestingEarningsPacketStatus =
  (typeof INVESTING_EARNINGS_PACKET_STATUSES)[number];

type ExportFormat = "json" | "markdown";

export interface InvestingEarningsPacketCatalyst {
  eventId: string;
  symbol: string;
  asOf: string;
  headline: string;
  delta: string;
  classification: InvestingEventDeltaItem["classification"];
  direction: InvestingEventDeltaItem["direction"];
  materialityBand: InvestingEventDeltaItem["materialityBand"];
  materialityScore: number;
  implications: string[];
}

export interface InvestingEarningsPacketRisk {
  id: string;
  source: "thesis-watchpoint" | "event-delta" | "diagnostic";
  summary: string;
  detail?: string;
}

export interface InvestingEarningsPacketCitation {
  citation: string;
  link: string;
  toolId: string;
  sourceLabel: string;
  status: InvestingResearchExecution["status"] | "completed" | "error";
}

export interface InvestingEarningsPacketSection {
  id: string;
  title: string;
  body: string;
  citations: string[];
}

export interface InvestingEarningsPacketValuationChange {
  basis: "thesis-ledger";
  current: InvestingThesisValuationSnapshot | null;
  previousPacketId?: string;
  previousWorkflow?: InvestingEarningsPacketWorkflow;
  previous: InvestingThesisValuationSnapshot | null;
  signalChanged: boolean;
  upsidePercentDelta: number | null;
  narrative: string;
}

export interface InvestingEarningsPacket {
  id: string;
  schemaVersion: "earnings-packet.v1";
  status: InvestingEarningsPacketStatus;
  workflow: InvestingEarningsPacketWorkflow;
  symbol: string;
  planId: string;
  taskId: string;
  executionId: string;
  artifactId?: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  objective: string;
  summary: string;
  catalysts: InvestingEarningsPacketCatalyst[];
  risks: InvestingEarningsPacketRisk[];
  valuation: InvestingEarningsPacketValuationChange;
  citations: InvestingEarningsPacketCitation[];
  diagnostics: InvestingResearchArtifactDiagnostic[];
  sections: InvestingEarningsPacketSection[];
  audit: {
    generatedAt: string;
    lastExportedAt?: string;
    exportCount: number;
  };
}

type PacketState = {
  version: 1;
  packets: InvestingEarningsPacket[];
};

type CreateInvestingEarningsPacketInput = {
  execution: InvestingResearchExecution;
  plan: InvestingResearchPlan;
  task: InvestingResearchTask;
  overwrite?: boolean;
};

function getPacketStateDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee");
  return path.join(stateDir, "investing");
}

export function getInvestingEarningsPacketStateFile(): string {
  return path.join(getPacketStateDir(), "earnings-packets.json");
}

function ensurePacketStateDir(): void {
  mkdirSync(getPacketStateDir(), { recursive: true });
}

function readPacketState(): PacketState {
  const filePath = getInvestingEarningsPacketStateFile();
  if (!existsSync(filePath)) {
    return { version: 1, packets: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<PacketState>;
    return {
      version: 1,
      packets: Array.isArray(parsed.packets) ? parsed.packets : [],
    };
  } catch (error) {
    log.warn("failed to read earnings packet state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { version: 1, packets: [] };
  }
}

function writePacketState(state: PacketState): void {
  ensurePacketStateDir();
  writeFileSync(getInvestingEarningsPacketStateFile(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function workflowLabel(workflow: InvestingEarningsPacketWorkflow): string {
  return workflow === "earnings-preview" ? "Earnings Preview" : "Post-Earnings Review";
}

function eventDeltaModeForWorkflow(
  workflow: InvestingEarningsPacketWorkflow,
): "pre-earnings" | "post-earnings" {
  return workflow === "earnings-preview" ? "pre-earnings" : "post-earnings";
}

function formatSignedDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

function citationsFromExecution(
  execution: InvestingResearchExecution,
): InvestingEarningsPacketCitation[] {
  return execution.evidence.map((item) => ({
    citation: item.citation,
    link: item.link,
    toolId: item.toolId,
    sourceLabel: item.sourceLabel,
    status: item.status,
  }));
}

function buildValuationNarrative(input: {
  current: InvestingThesisValuationSnapshot | null;
  previous: InvestingThesisValuationSnapshot | null;
}): {
  signalChanged: boolean;
  upsidePercentDelta: number | null;
  narrative: string;
} {
  const signalChanged =
    Boolean(input.current?.signal) &&
    Boolean(input.previous?.signal) &&
    input.current?.signal !== input.previous?.signal;
  const upsidePercentDelta =
    input.current?.upsidePercent != null && input.previous?.upsidePercent != null
      ? input.current.upsidePercent - input.previous.upsidePercent
      : null;

  const parts: string[] = [];

  if (input.current?.signal && input.previous?.signal) {
    if (signalChanged) {
      parts.push(
        `Valuation signal moved from ${input.previous.signal} to ${input.current.signal}.`,
      );
    } else {
      parts.push(`Valuation signal remains ${input.current.signal}.`);
    }
  } else if (input.current?.signal) {
    parts.push(`Current valuation signal is ${input.current.signal}.`);
  } else {
    parts.push("No linked valuation signal is available for this packet.");
  }

  if (input.current?.upsidePercent != null && input.previous?.upsidePercent != null) {
    parts.push(
      `Upside moved ${formatSignedDelta(upsidePercentDelta ?? 0)} to ${input.current.upsidePercent.toFixed(1)}%.`,
    );
  } else if (input.current?.upsidePercent != null) {
    parts.push(`Current valuation implies ${input.current.upsidePercent.toFixed(1)}% upside.`);
  }

  if (input.current?.valuationCaseId) {
    parts.push(`Case: ${input.current.valuationCaseId}.`);
  }

  return {
    signalChanged,
    upsidePercentDelta,
    narrative: parts.join(" "),
  };
}

function buildCatalysts(
  items: InvestingEventDeltaItem[],
  symbol: string,
): InvestingEarningsPacketCatalyst[] {
  return items
    .filter((item) => normalizeSymbol(item.symbol ?? symbol) === symbol)
    .map((item) => ({
      eventId: item.eventId,
      symbol,
      asOf: item.asOf,
      headline: item.headline,
      delta: item.delta,
      classification: item.classification,
      direction: item.direction,
      materialityBand: item.materialityBand,
      materialityScore: item.materialityScore,
      implications: item.implications,
    }));
}

function buildRisks(input: {
  symbol: string;
  watchpoints: string[];
  catalysts: InvestingEarningsPacketCatalyst[];
  diagnostics: InvestingResearchArtifactDiagnostic[];
}): InvestingEarningsPacketRisk[] {
  const risks: InvestingEarningsPacketRisk[] = [];

  for (const watchpoint of input.watchpoints) {
    risks.push({
      id: `risk-watchpoint-${randomUUID().slice(0, 8)}`,
      source: "thesis-watchpoint",
      summary: watchpoint,
    });
  }

  for (const catalyst of input.catalysts) {
    if (catalyst.direction !== "negative" && catalyst.materialityBand !== "critical") continue;
    risks.push({
      id: `risk-event-${catalyst.eventId}`,
      source: "event-delta",
      summary: `${catalyst.headline} raises downside risk for ${input.symbol}.`,
      detail: catalyst.implications.join(" "),
    });
  }

  for (const diagnostic of input.diagnostics) {
    risks.push({
      id: `risk-diagnostic-${diagnostic.id}`,
      source: "diagnostic",
      summary: diagnostic.summary,
      detail: diagnostic.operatorAction,
    });
  }

  const deduped = new Map<string, InvestingEarningsPacketRisk>();
  for (const risk of risks) {
    deduped.set(`${risk.source}:${risk.summary}:${risk.detail ?? ""}`, risk);
  }
  return [...deduped.values()];
}

function buildSections(input: {
  packet: Omit<InvestingEarningsPacket, "sections">;
  synthesis: string;
}): InvestingEarningsPacketSection[] {
  const evidenceCitations = input.packet.citations.map((item) => item.citation);

  const sections: InvestingEarningsPacketSection[] = [
    {
      id: "overview",
      title: "Overview",
      body: [
        `Objective: ${input.packet.objective}`,
        `Workflow: ${input.packet.workflow}`,
        `Task: ${input.packet.taskId}`,
        `Status: ${input.packet.status}`,
        input.packet.summary,
      ].join("\n"),
      citations: [],
    },
    {
      id: "synthesis",
      title: "Synthesis",
      body: input.synthesis,
      citations: evidenceCitations,
    },
    {
      id: "catalysts",
      title: "Catalysts",
      body:
        input.packet.catalysts.length > 0
          ? input.packet.catalysts
              .map((catalyst) =>
                [
                  `- ${catalyst.headline}`,
                  `  ${catalyst.classification} / ${catalyst.direction} / ${catalyst.materialityBand} ${catalyst.materialityScore}/100`,
                  `  ${catalyst.delta}`,
                  `  Implications: ${catalyst.implications.join(" | ") || "n/a"}`,
                ].join("\n"),
              )
              .join("\n")
          : "- No qualifying event deltas were available for this packet.",
      citations: [],
    },
    {
      id: "risks",
      title: "Risks",
      body:
        input.packet.risks.length > 0
          ? input.packet.risks
              .map((risk) =>
                [
                  `- ${risk.summary}`,
                  risk.detail ? `  Detail: ${risk.detail}` : null,
                ]
                  .filter(Boolean)
                  .join("\n"),
              )
              .join("\n")
          : "- No explicit risks were captured beyond the current packet evidence.",
      citations: [],
    },
    {
      id: "valuation",
      title: "Valuation Change",
      body: [
        input.packet.valuation.narrative,
        `Current fair value: ${input.packet.valuation.current?.fairValue ?? "n/a"}`,
        `Current price: ${input.packet.valuation.current?.currentPrice ?? "n/a"}`,
        `Previous packet: ${input.packet.valuation.previousPacketId ?? "none"}`,
      ].join("\n"),
      citations: evidenceCitations.filter((citation) =>
        input.packet.citations.some(
          (item) => item.citation === citation && item.toolId === "zee:invest-valuation",
        ),
      ),
    },
    {
      id: "evidence",
      title: "Evidence",
      body:
        input.packet.citations.length > 0
          ? input.packet.citations
              .map(
                (citation) =>
                  `- [${citation.citation}] ${citation.sourceLabel} (${citation.status}) via ${citation.toolId}`,
              )
              .join("\n")
          : "- No evidence links were persisted.",
      citations: evidenceCitations,
    },
  ];

  if (input.packet.diagnostics.length > 0) {
    sections.push({
      id: "diagnostics",
      title: "Diagnostics",
      body: input.packet.diagnostics
        .map((diagnostic) =>
          [
            `- ${diagnostic.summary}`,
            `  Detail: ${diagnostic.detail}`,
            `  Action: ${diagnostic.operatorAction}`,
            diagnostic.command ? `  Command: ${diagnostic.command}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n"),
      citations: [],
    });
  }

  return sections;
}

function renderPacketMarkdown(packet: InvestingEarningsPacket): string {
  return [
    `# ${packet.title}`,
    "",
    `- Symbol: ${packet.symbol}`,
    `- Workflow: ${packet.workflow}`,
    `- Status: ${packet.status}`,
    `- Summary: ${packet.summary}`,
    "",
    ...packet.sections.flatMap((section) => [
      `## ${section.title}`,
      section.body,
      "",
    ]),
  ]
    .join("\n")
    .trim();
}

function assertEarningsWorkflow(
  workflow: string,
): asserts workflow is InvestingEarningsPacketWorkflow {
  if (
    workflow !== "earnings-preview" &&
    workflow !== "earnings-review"
  ) {
    throw new Error(`Unsupported earnings packet workflow: ${workflow}`);
  }
}

export function findInvestingEarningsPacketByExecution(
  executionId: string,
): InvestingEarningsPacket | null {
  const state = readPacketState();
  return state.packets.find((packet) => packet.executionId === executionId) ?? null;
}

export async function createInvestingEarningsPacket(
  input: CreateInvestingEarningsPacketInput,
): Promise<InvestingEarningsPacket> {
  assertEarningsWorkflow(input.plan.workflow);

  const existing = findInvestingEarningsPacketByExecution(input.execution.id);
  if (existing && !input.overwrite) {
    return existing;
  }

  const symbol = normalizeSymbol(input.plan.symbols[0] ?? "");
  if (!symbol) {
    throw new Error("Earnings packets require a primary symbol.");
  }

  const state = readPacketState();
  const artifact = input.execution.artifactId
    ? getInvestingResearchArtifact(input.execution.artifactId)
    : null;
  const thesis = getInvestingThesis(thesisKeyForSymbol(symbol));
  const eventDeltaBrief = await buildInvestingEventDeltaBrief({
    mode: eventDeltaModeForWorkflow(input.plan.workflow),
    symbols: [symbol],
  });
  const catalysts = buildCatalysts(eventDeltaBrief.items, symbol);
  const diagnostics = artifact?.diagnostics ?? [];
  const previousPacket =
    state.packets.find(
      (packet) =>
        packet.symbol === symbol &&
        packet.executionId !== input.execution.id,
    ) ?? null;
  const valuationSummary = buildValuationNarrative({
    current: thesis?.valuation ?? null,
    previous: previousPacket?.valuation.current ?? null,
  });
  const risks = buildRisks({
    symbol,
    watchpoints: thesis?.watchpoints ?? [],
    catalysts,
    diagnostics,
  });
  const createdAt = new Date().toISOString();
  const status: InvestingEarningsPacketStatus =
    input.execution.status === "ok" && diagnostics.length === 0 ? "ready" : "degraded";
  const title = `${workflowLabel(input.plan.workflow)} Packet: ${symbol}`;
  const summary = `${workflowLabel(input.plan.workflow)} packet for ${symbol} captured ${catalysts.length} catalyst(s), ${risks.length} risk item(s), and ${thesis?.valuation?.signal ?? "no linked"} valuation context.`;

  const packetBase: Omit<InvestingEarningsPacket, "sections"> = {
    id: existing?.id ?? `earnings-packet-${randomUUID().slice(0, 12)}`,
    schemaVersion: "earnings-packet.v1",
    status,
    workflow: input.plan.workflow,
    symbol,
    planId: input.plan.id,
    taskId: input.task.id,
    executionId: input.execution.id,
    artifactId: input.execution.artifactId,
    createdAt: existing?.createdAt ?? createdAt,
    updatedAt: createdAt,
    title,
    objective: input.plan.objective,
    summary,
    catalysts,
    risks,
    valuation: {
      basis: "thesis-ledger",
      current: thesis?.valuation ?? null,
      previousPacketId: previousPacket?.id,
      previousWorkflow: previousPacket?.workflow,
      previous: previousPacket?.valuation.current ?? null,
      signalChanged: valuationSummary.signalChanged,
      upsidePercentDelta: valuationSummary.upsidePercentDelta,
      narrative: valuationSummary.narrative,
    },
    citations: citationsFromExecution(input.execution),
    diagnostics,
    audit: {
      generatedAt: existing?.audit.generatedAt ?? createdAt,
      lastExportedAt: existing?.audit.lastExportedAt,
      exportCount: existing?.audit.exportCount ?? 0,
    },
  };

  const packet: InvestingEarningsPacket = {
    ...packetBase,
    sections: buildSections({
      packet: packetBase,
      synthesis: input.execution.synthesis,
    }),
  };

  state.packets = [packet, ...state.packets.filter((entry) => entry.id !== packet.id)].slice(0, 300);
  writePacketState(state);

  FluxRecorder.record({
    traceID: packet.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.earnings.packet",
    status: packet.status === "ready" ? "ok" : "error",
    method: existing ? "update" : "create",
    path: packet.workflow,
    route: packet.id,
    metadata: {
      symbol: packet.symbol,
      planId: packet.planId,
      taskId: packet.taskId,
      executionId: packet.executionId,
      status: packet.status,
      schemaVersion: packet.schemaVersion,
      catalystCount: packet.catalysts.length,
      riskCount: packet.risks.length,
      signal: packet.valuation.current?.signal,
      previousPacketId: packet.valuation.previousPacketId,
    },
  });

  return packet;
}

export function getInvestingEarningsPacket(
  packetId: string,
): InvestingEarningsPacket | null {
  const state = readPacketState();
  return state.packets.find((packet) => packet.id === packetId) ?? null;
}

export function listInvestingEarningsPackets(options?: {
  symbol?: string;
  workflow?: InvestingEarningsPacketWorkflow;
  executionId?: string;
  limit?: number;
}): InvestingEarningsPacket[] {
  const normalizedSymbol = options?.symbol ? normalizeSymbol(options.symbol) : undefined;
  const state = readPacketState();
  return state.packets
    .filter((packet) => (normalizedSymbol ? packet.symbol === normalizedSymbol : true))
    .filter((packet) => (options?.workflow ? packet.workflow === options.workflow : true))
    .filter((packet) => (options?.executionId ? packet.executionId === options.executionId : true))
    .slice(0, options?.limit ?? 20);
}

export function exportInvestingEarningsPacket(input: {
  packetId: string;
  format: ExportFormat;
}): { packet: InvestingEarningsPacket; content: string } {
  const state = readPacketState();
  const packet = state.packets.find((entry) => entry.id === input.packetId);
  if (!packet) {
    throw new Error(`Earnings packet not found: ${input.packetId}`);
  }

  packet.audit.exportCount += 1;
  packet.audit.lastExportedAt = new Date().toISOString();
  writePacketState(state);

  FluxRecorder.record({
    traceID: packet.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.earnings.packet.export",
    status: "ok",
    method: "export",
    path: input.format,
    route: packet.id,
    metadata: {
      workflow: packet.workflow,
      symbol: packet.symbol,
      exportCount: packet.audit.exportCount,
    },
  });

  return {
    packet,
    content: input.format === "markdown" ? renderPacketMarkdown(packet) : JSON.stringify(packet, null, 2),
  };
}
