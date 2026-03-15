/**
 * Investing Research Synthesis Executor
 *
 * Executes planner steps across multiple investing sources, persists
 * evidence-linked synthesis packets, and advances the underlying workflow.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FluxRecorder } from "../../../packages/zee/src/flux";
import {
  appendInvestingProvenance,
  summarizeInvestingProvenance,
  type InvestingProvenanceSummary,
  type ToolTrace,
} from "../../../packages/zee/src/session/investing-provenance";
import { Log } from "../../../packages/zee/src/util/log";
import { Investing } from "../../paths";
import {
  getInvestingResearchPlan,
  updateInvestingResearchTask,
  type InvestingResearchPlan,
  type InvestingResearchTask,
} from "./planner";

const log = Log.create({ service: "investing:research-executor" });

export type InvestingResearchExecutionStatus = "ok" | "error";
export type InvestingResearchEvidenceStatus = "completed" | "error";

export interface InvestingResearchEvidence {
  id: string;
  citation: string;
  link: string;
  toolId: string;
  sourceLabel: string;
  args: Record<string, unknown>;
  collectedAt: string;
  status: InvestingResearchEvidenceStatus;
  summary: string;
  data?: unknown;
  error?: string;
}

export interface InvestingResearchExecution {
  id: string;
  planId: string;
  taskId: string;
  workflow: string;
  status: InvestingResearchExecutionStatus;
  startedAt: string;
  finishedAt: string;
  synthesis: string;
  evidence: InvestingResearchEvidence[];
  provenance: InvestingProvenanceSummary | null;
}

type ExecutionState = {
  version: 1;
  executions: InvestingResearchExecution[];
};

type InvestingRequestResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type RunInvestingResearchExecutionInput = {
  planId: string;
  taskId?: string;
};

function getExecutorStateDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee");
  return path.join(stateDir, "investing");
}

export function getInvestingResearchExecutionStateFile(): string {
  return path.join(getExecutorStateDir(), "research-executions.json");
}

function ensureExecutorStateDir(): void {
  mkdirSync(getExecutorStateDir(), { recursive: true });
}

function readExecutionState(): ExecutionState {
  const filePath = getInvestingResearchExecutionStateFile();
  if (!existsSync(filePath)) {
    return { version: 1, executions: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ExecutionState;
    return {
      version: 1,
      executions: Array.isArray(parsed.executions) ? parsed.executions : [],
    };
  } catch (error) {
    log.warn("failed to read research execution state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { version: 1, executions: [] };
  }
}

function writeExecutionState(state: ExecutionState): void {
  ensureExecutorStateDir();
  writeFileSync(getInvestingResearchExecutionStateFile(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function normalizeSymbol(symbol?: string): string | undefined {
  const trimmed = symbol?.trim().toUpperCase();
  if (!trimmed) return undefined;
  return trimmed;
}

async function requestInvesting(pathname: string, init?: RequestInit): Promise<InvestingRequestResult> {
  try {
    const baseUrl = Investing.apiUrl().replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
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

function summarizeEvidenceData(data: unknown): string {
  if (data == null) return "No data returned.";
  if (typeof data === "string") {
    return data.length <= 180 ? data : `${data.slice(0, 180)}...`;
  }
  if (Array.isArray(data)) {
    return `${data.length} record(s) collected.`;
  }
  if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.symbol === "string") {
      return `Symbol ${record.symbol} with fields: ${Object.keys(record).slice(0, 4).join(", ")}.`;
    }
    if (typeof record.note === "string") {
      return record.note;
    }
    const keys = Object.keys(record);
    return keys.length > 0
      ? `Object fields: ${keys.slice(0, 5).join(", ")}.`
      : "Structured object with no top-level fields.";
  }
  return String(data);
}

function latestDependencyEvidence(
  state: ExecutionState,
  plan: InvestingResearchPlan,
  task: InvestingResearchTask,
): InvestingResearchEvidence[] {
  return task.dependsOn.flatMap((dependency) => {
    const latest = state.executions.find((execution) => execution.planId === plan.id && execution.taskId === dependency);
    return latest?.evidence ?? [];
  });
}

function createEvidenceLink(executionId: string, index: number): { id: string; citation: string; link: string } {
  const citation = `E${index + 1}`;
  return {
    id: `${executionId}:${citation}`,
    citation,
    link: `evidence:${executionId}:${citation}`,
  };
}

function sourceLabelForTool(toolId: string): string {
  switch (toolId) {
    case "zee:invest-status":
      return "Investing runtime health";
    case "zee:invest-sec-filings":
      return "SEC filings";
    case "zee:invest-research":
      return "Research endpoint";
    case "zee:invest-market-data":
      return "Market data";
    case "zee:invest-estimates":
      return "Analyst estimates";
    case "zee:invest-insider-trades":
      return "Insider trades";
    case "zee:invest-segments":
      return "Business segments";
    default:
      return toolId;
  }
}

async function collectToolEvidence(input: {
  plan: InvestingResearchPlan;
  task: InvestingResearchTask;
  toolId: string;
}): Promise<{ args: Record<string, unknown>; result: InvestingRequestResult }> {
  const primarySymbol = normalizeSymbol(input.plan.symbols[0]);

  switch (input.toolId) {
    case "zee:invest-status":
      return {
        args: {},
        result: await requestInvesting("/api/health"),
      };
    case "zee:invest-sec-filings":
      if (!primarySymbol) {
        return {
          args: {},
          result: { ok: false, error: "A symbol is required for SEC filings execution." },
        };
      }
      return {
        args: { ticker: primarySymbol, formType: "all" },
        result: await requestInvesting(`/api/accounting/${primarySymbol}/filings`),
      };
    case "zee:invest-research":
      if (primarySymbol) {
        return {
          args: { query: primarySymbol },
          result: await requestInvesting(`/api/research/${primarySymbol}`),
        };
      }
      return {
        args: { query: input.plan.objective },
        result: {
          ok: true,
          data: {
            objective: input.plan.objective,
            note: "No explicit symbol in plan scope; research query remains objective-scoped.",
          },
        },
      };
    case "zee:invest-market-data":
      if (!primarySymbol) {
        return {
          args: {},
          result: { ok: false, error: "A symbol is required for market data execution." },
        };
      }
      return {
        args: { symbol: primarySymbol, dataType: "fundamentals" },
        result: await requestInvesting(`/api/market/${primarySymbol}`),
      };
    case "zee:invest-estimates":
      if (!primarySymbol) {
        return {
          args: {},
          result: { ok: false, error: "A symbol is required for estimates execution." },
        };
      }
      return {
        args: { symbol: primarySymbol, estimateType: "consensus" },
        result: await requestInvesting(`/api/valuation/${primarySymbol}`),
      };
    case "zee:invest-insider-trades":
      if (!primarySymbol) {
        return {
          args: {},
          result: { ok: false, error: "A symbol is required for insider trade execution." },
        };
      }
      return {
        args: { symbol: primarySymbol, limit: 10 },
        result: await requestInvesting(`/api/institutional/${primarySymbol}/smart-money-flow`),
      };
    case "zee:invest-segments":
      return {
        args: { symbol: primarySymbol, segmentType: "business" },
        result: {
          ok: true,
          data: {
            symbol: primarySymbol,
            note: "Segment detail is not yet exposed on the investing HTTP surface; preserve as a planner-linked gap.",
          },
        },
      };
    default:
      return {
        args: {},
        result: {
          ok: true,
          data: {
            note: `Execution for ${input.toolId} is operator-managed or not directly automatable in this slice.`,
          },
        },
      };
  }
}

function buildSynthesis(input: {
  plan: InvestingResearchPlan;
  task: InvestingResearchTask;
  evidence: InvestingResearchEvidence[];
  provenance: InvestingProvenanceSummary | null;
}): string {
  const evidenceLines =
    input.evidence.length > 0
      ? input.evidence
          .map((item) => `- [${item.citation}] ${item.sourceLabel} (${item.link}): ${item.summary}`)
          .join("\n")
      : "- No evidence items were collected."

  const synthesis = [
    `${input.task.title}`,
    `Objective: ${input.plan.objective}`,
    `Workflow: ${input.plan.workflow}`,
    `Deliverable: ${input.task.deliverable}`,
    "",
    "Evidence Links:",
    evidenceLines,
  ].join("\n");

  return input.provenance ? appendInvestingProvenance(synthesis, input.provenance) : synthesis;
}

function resolveTask(plan: InvestingResearchPlan, taskId?: string): InvestingResearchTask {
  if (taskId) {
    const explicit = plan.tasks.find((task) => task.id === taskId);
    if (!explicit) {
      throw new Error(`Research task not found: ${taskId}`);
    }
    return explicit;
  }

  return (
    plan.tasks.find((task) => task.status === "in_progress") ??
    plan.tasks.find((task) => task.status === "pending") ??
    plan.tasks[0]
  );
}

export async function runInvestingResearchExecution(
  input: RunInvestingResearchExecutionInput,
): Promise<InvestingResearchExecution> {
  const plan = getInvestingResearchPlan(input.planId);
  if (!plan) {
    throw new Error(`Research plan not found: ${input.planId}`);
  }

  const task = resolveTask(plan, input.taskId);
  const executionId = `research-execution-${randomUUID().slice(0, 12)}`;
  const startedAt = new Date().toISOString();
  const state = readExecutionState();
  const evidence: InvestingResearchEvidence[] = [];
  const toolTraces: ToolTrace[] = [];

  const executableToolIds = task.toolIds.filter((toolId) => toolId !== "zee:invest-scratchpad");
  for (const toolId of executableToolIds) {
    const { args, result } = await collectToolEvidence({ plan, task, toolId });
    const ref = createEvidenceLink(executionId, evidence.length);
    const item: InvestingResearchEvidence = {
      ...ref,
      toolId,
      sourceLabel: sourceLabelForTool(toolId),
      args,
      collectedAt: new Date().toISOString(),
      status: result.ok ? "completed" : "error",
      summary: result.ok ? summarizeEvidenceData(result.data) : result.error || "Execution failed.",
      data: result.data,
      error: result.error,
    };
    evidence.push(item);
    toolTraces.push({
      tool: toolId,
      status: result.ok ? "completed" : "error",
      error: result.error,
    });

  }

  if (evidence.length === 0) {
    const dependencyEvidence = latestDependencyEvidence(state, plan, task);
    for (const [index, source] of dependencyEvidence.entries()) {
      evidence.push({
        ...source,
        ...createEvidenceLink(executionId, index),
      });
      toolTraces.push({
        tool: source.toolId,
        status: source.status === "completed" ? "completed" : "error",
        error: source.error,
      });
    }
  }

  for (const item of evidence) {
    FluxRecorder.record({
      traceID: executionId,
      direction: "internal",
      domain: "investing",
      kind: "investing.research.evidence",
      status: item.status === "completed" ? "ok" : "error",
      method: "collect",
      path: item.toolId,
      route: item.link,
      metadata: {
        planId: plan.id,
        taskId: task.id,
        citation: item.citation,
        sourceLabel: item.sourceLabel,
        summary: item.summary,
      },
      error: item.error ? { message: item.error } : undefined,
    });
  }

  const finishedAt = new Date().toISOString();
  const provenance = summarizeInvestingProvenance(toolTraces);
  const status: InvestingResearchExecutionStatus = evidence.some((item) => item.status === "completed")
    ? "ok"
    : "error";
  const execution: InvestingResearchExecution = {
    id: executionId,
    planId: plan.id,
    taskId: task.id,
    workflow: plan.workflow,
    status,
    startedAt,
    finishedAt,
    synthesis: buildSynthesis({
      plan,
      task,
      evidence,
      provenance,
    }),
    evidence,
    provenance,
  };

  state.executions = [execution, ...state.executions].slice(0, 500);
  writeExecutionState(state);

  FluxRecorder.record({
    traceID: execution.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.research.execution",
    status: execution.status === "ok" ? "ok" : "error",
    method: "run",
    path: task.id,
    route: execution.id,
    metadata: {
      planId: plan.id,
      workflow: plan.workflow,
      evidenceCount: evidence.length,
      taskTitle: task.title,
    },
  });

  updateInvestingResearchTask({
    planId: plan.id,
    taskId: task.id,
    status: execution.status === "ok" ? "completed" : "blocked",
    note:
      execution.status === "ok"
        ? `Execution ${execution.id} collected ${evidence.length} evidence item(s).`
        : `Execution ${execution.id} failed to collect usable evidence.`,
  });

  return execution;
}

export function getInvestingResearchExecution(executionId: string): InvestingResearchExecution | null {
  const state = readExecutionState();
  return state.executions.find((execution) => execution.id === executionId) ?? null;
}

export function listInvestingResearchExecutions(options?: {
  planId?: string;
  taskId?: string;
  limit?: number;
}): InvestingResearchExecution[] {
  const state = readExecutionState();
  return state.executions
    .filter((execution) => (options?.planId ? execution.planId === options.planId : true))
    .filter((execution) => (options?.taskId ? execution.taskId === options.taskId : true))
    .slice(0, options?.limit ?? 20);
}
