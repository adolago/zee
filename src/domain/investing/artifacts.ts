/**
 * Investing Research Report Artifacts
 *
 * Turns research executions into stable, structured artifacts that future
 * review and evaluation flows can score without reparsing freeform text.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FluxRecorder } from "../../../packages/zee/src/flux";
import { Log } from "../../../packages/zee/src/util/log";
import type { InvestingResearchExecution, InvestingResearchEvidence } from "./executor";
import type { InvestingResearchPlan, InvestingResearchTask } from "./planner";

const log = Log.create({ service: "investing:research-artifacts" });

export const INVESTING_RESEARCH_ARTIFACT_KINDS = [
  "scope-note",
  "source-delta",
  "analysis-memo",
  "research-brief",
  "failure-diagnostic",
] as const;

export type InvestingResearchArtifactKind = (typeof INVESTING_RESEARCH_ARTIFACT_KINDS)[number];

export const INVESTING_RESEARCH_ARTIFACT_STATUSES = ["ready", "degraded", "failed"] as const;

export type InvestingResearchArtifactStatus = (typeof INVESTING_RESEARCH_ARTIFACT_STATUSES)[number];

export interface InvestingResearchArtifactCitation {
  citation: string;
  link: string;
  toolId: string;
  sourceLabel: string;
  status: InvestingResearchEvidence["status"];
}

export interface InvestingResearchArtifactSection {
  id: string;
  title: string;
  body: string;
  citations: string[];
}

export interface InvestingResearchArtifactDiagnostic {
  id: string;
  severity: "warning" | "error";
  toolId?: string;
  summary: string;
  detail: string;
  operatorAction: string;
  command?: string;
}

export interface InvestingResearchArtifact {
  id: string;
  executionId: string;
  planId: string;
  taskId: string;
  workflow: InvestingResearchPlan["workflow"];
  kind: InvestingResearchArtifactKind;
  status: InvestingResearchArtifactStatus;
  title: string;
  objective: string;
  symbols: string[];
  createdAt: string;
  updatedAt: string;
  summary: string;
  sections: InvestingResearchArtifactSection[];
  citations: InvestingResearchArtifactCitation[];
  nextActions: string[];
  diagnostics: InvestingResearchArtifactDiagnostic[];
}

type ArtifactState = {
  version: 1;
  artifacts: InvestingResearchArtifact[];
};

type CreateInvestingResearchArtifactInput = {
  execution: InvestingResearchExecution;
  plan: InvestingResearchPlan;
  task: InvestingResearchTask;
  overwrite?: boolean;
};

function getArtifactStateDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee");
  return path.join(stateDir, "investing");
}

export function getInvestingResearchArtifactStateFile(): string {
  return path.join(getArtifactStateDir(), "research-artifacts.json");
}

function ensureArtifactStateDir(): void {
  mkdirSync(getArtifactStateDir(), { recursive: true });
}

function readArtifactState(): ArtifactState {
  const filePath = getInvestingResearchArtifactStateFile();
  if (!existsSync(filePath)) {
    return { version: 1, artifacts: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ArtifactState;
    return {
      version: 1,
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
    };
  } catch (error) {
    log.warn("failed to read research artifact state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { version: 1, artifacts: [] };
  }
}

function writeArtifactState(state: ArtifactState): void {
  ensureArtifactStateDir();
  writeFileSync(getInvestingResearchArtifactStateFile(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function artifactKindForExecution(
  execution: InvestingResearchExecution,
  task: InvestingResearchTask,
): InvestingResearchArtifactKind {
  if (execution.status === "error") return "failure-diagnostic";

  switch (task.phase) {
    case "intake":
      return "scope-note";
    case "data":
      return "source-delta";
    case "analysis":
      return "analysis-memo";
    case "synthesis":
    default:
      return "research-brief";
  }
}

function artifactStatusForExecution(execution: InvestingResearchExecution): InvestingResearchArtifactStatus {
  if (execution.status === "error") return "failed";
  return execution.evidence.some((item) => item.status === "error") ? "degraded" : "ready";
}

function firstSymbol(plan: InvestingResearchPlan): string | undefined {
  return plan.symbols[0];
}

function remediationForFailure(input: {
  toolId?: string;
  error?: string;
  plan: InvestingResearchPlan;
}): Pick<InvestingResearchArtifactDiagnostic, "operatorAction" | "command"> {
  const normalizedError = input.error?.toLowerCase() ?? "";
  const symbol = firstSymbol(input.plan);

  if (normalizedError.includes("symbol is required")) {
    return {
      operatorAction: "Recreate or update the research plan with an explicit ticker scope before rerunning this task.",
    };
  }

  if (
    normalizedError.includes("connection") ||
    normalizedError.includes("fetch") ||
    normalizedError.includes("timed out") ||
    normalizedError.includes("status 5")
  ) {
    return {
      operatorAction: "Validate investing runtime health, then rerun the execution once the service is stable.",
      command: "zee investing ingest status",
    };
  }

  switch (input.toolId) {
    case "zee:invest-sec-filings":
      return {
        operatorAction: `Confirm filing coverage${symbol ? ` for ${symbol}` : ""} and backfill stale primary-source data before retrying.`,
        command: "zee investing ingest status",
      };
    case "zee:invest-market-data":
    case "zee:invest-estimates":
    case "zee:invest-insider-trades":
      return {
        operatorAction: "Check the affected data connector health and refresh stale coverage before rerunning.",
        command: "zee investing ingest status",
      };
    case "zee:invest-research":
      return {
        operatorAction: "Inspect the research endpoint response and restore source coverage before rerunning the workflow step.",
        command: "zee investing ingest status",
      };
    default:
      return {
        operatorAction: "Inspect the failing source, restore coverage, and rerun the execution when the dependency is healthy.",
      };
  }
}

function buildDiagnostics(input: {
  execution: InvestingResearchExecution;
  plan: InvestingResearchPlan;
  task: InvestingResearchTask;
}): InvestingResearchArtifactDiagnostic[] {
  const diagnostics: InvestingResearchArtifactDiagnostic[] = [];

  const failedEvidence = input.execution.evidence.filter((item) => item.status === "error");
  for (const item of failedEvidence) {
    const remediation = remediationForFailure({
      toolId: item.toolId,
      error: item.error,
      plan: input.plan,
    });

    diagnostics.push({
      id: `diagnostic-${randomUUID().slice(0, 12)}`,
      severity: input.execution.status === "error" ? "error" : "warning",
      toolId: item.toolId,
      summary: `${item.sourceLabel} failed during ${input.task.id}.`,
      detail: item.error || "The source returned an unspecified error.",
      operatorAction: remediation.operatorAction,
      command: remediation.command,
    });
  }

  if (input.execution.status === "error" && failedEvidence.length === 0) {
    diagnostics.push({
      id: `diagnostic-${randomUUID().slice(0, 12)}`,
      severity: "error",
      summary: "The execution finished without any usable evidence.",
      detail: "No completed evidence items were persisted for this workflow step.",
      operatorAction: "Review the plan scope and source mappings, then rerun the task once a usable source path is available.",
    });
  }

  if (input.plan.status === "blocked") {
    diagnostics.push({
      id: `diagnostic-${randomUUID().slice(0, 12)}`,
      severity: "error",
      summary: "The plan is blocked after this execution.",
      detail: `Task ${input.task.id} is blocking downstream work until this failure is resolved.`,
      operatorAction: "Resolve the failed source diagnostics, then rerun the blocked task to unblock the research plan.",
    });
  }

  return diagnostics;
}

function buildSections(input: {
  execution: InvestingResearchExecution;
  plan: InvestingResearchPlan;
  task: InvestingResearchTask;
  diagnostics: InvestingResearchArtifactDiagnostic[];
}): InvestingResearchArtifactSection[] {
  const evidenceCitations = input.execution.evidence.map((item) => item.citation);
  const sections: InvestingResearchArtifactSection[] = [
    {
      id: "overview",
      title: "Overview",
      body: [
        `Objective: ${input.plan.objective}`,
        `Workflow: ${input.plan.workflow}`,
        `Task: ${input.task.title}`,
        `Deliverable: ${input.task.deliverable}`,
        `Symbols: ${input.plan.symbols.length > 0 ? input.plan.symbols.join(", ") : "scope not pinned"}`,
      ].join("\n"),
      citations: [],
    },
    {
      id: "synthesis",
      title: "Synthesis",
      body: input.execution.synthesis,
      citations: evidenceCitations,
    },
    {
      id: "evidence",
      title: "Evidence",
      body:
        input.execution.evidence.length > 0
          ? input.execution.evidence
              .map(
                (item) =>
                  `- [${item.citation}] ${item.sourceLabel} (${item.status}): ${item.summary}`,
              )
              .join("\n")
          : "- No evidence items were persisted.",
      citations: evidenceCitations,
    },
  ];

  if (input.diagnostics.length > 0) {
    sections.push({
      id: "diagnostics",
      title: "Diagnostics",
      body: input.diagnostics
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

function buildSummary(input: {
  execution: InvestingResearchExecution;
  plan: InvestingResearchPlan;
  task: InvestingResearchTask;
  diagnostics: InvestingResearchArtifactDiagnostic[];
  status: InvestingResearchArtifactStatus;
}): string {
  const completedEvidence = input.execution.evidence.filter((item) => item.status === "completed").length;

  if (input.status === "failed") {
    return `${input.task.title} failed for ${input.plan.objective}; ${input.diagnostics.length} actionable diagnostic(s) were captured.`;
  }
  if (input.status === "degraded") {
    return `${input.task.title} completed with gaps: ${completedEvidence}/${input.execution.evidence.length} evidence item(s) succeeded.`;
  }
  return `${input.task.title} produced a structured artifact with ${completedEvidence} evidence item(s).`;
}

function buildNextActions(input: {
  plan: InvestingResearchPlan;
  task: InvestingResearchTask;
  status: InvestingResearchArtifactStatus;
  diagnostics: InvestingResearchArtifactDiagnostic[];
}): string[] {
  const actions: string[] = [];

  if (input.status === "failed") {
    actions.push(...input.diagnostics.map((diagnostic) => diagnostic.operatorAction));
    return Array.from(new Set(actions));
  }

  if (input.status === "degraded") {
    actions.push("Review the warning diagnostics before using this artifact as a final research deliverable.");
  }

  const nextTask = input.plan.tasks.find((candidate) => candidate.status === "in_progress");
  if (nextTask && nextTask.id !== input.task.id) {
    actions.push(`Run the next task: ${nextTask.title}.`);
  } else if (input.plan.status === "completed") {
    actions.push("Review the completed artifact set and promote the final brief into the next portfolio or thesis workflow.");
  } else if (input.plan.status === "blocked") {
    actions.push("Resolve the blocked task diagnostics before continuing the plan.");
  }

  return Array.from(new Set(actions));
}

export function findInvestingResearchArtifactByExecution(
  executionId: string,
): InvestingResearchArtifact | null {
  const state = readArtifactState();
  return state.artifacts.find((artifact) => artifact.executionId === executionId) ?? null;
}

export function createInvestingResearchArtifact(
  input: CreateInvestingResearchArtifactInput,
): InvestingResearchArtifact {
  const state = readArtifactState();
  const existing = state.artifacts.find((artifact) => artifact.executionId === input.execution.id);
  if (existing && !input.overwrite) {
    return existing;
  }

  const diagnostics = buildDiagnostics(input);
  const status = artifactStatusForExecution(input.execution);
  const timestamp = new Date().toISOString();
  const artifact: InvestingResearchArtifact = {
    id: existing?.id ?? `research-artifact-${randomUUID().slice(0, 12)}`,
    executionId: input.execution.id,
    planId: input.plan.id,
    taskId: input.task.id,
    workflow: input.plan.workflow,
    kind: artifactKindForExecution(input.execution, input.task),
    status,
    title: `${input.task.title} artifact`,
    objective: input.plan.objective,
    symbols: input.plan.symbols,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    summary: buildSummary({
      execution: input.execution,
      plan: input.plan,
      task: input.task,
      diagnostics,
      status,
    }),
    sections: buildSections({
      execution: input.execution,
      plan: input.plan,
      task: input.task,
      diagnostics,
    }),
    citations: input.execution.evidence.map((item) => ({
      citation: item.citation,
      link: item.link,
      toolId: item.toolId,
      sourceLabel: item.sourceLabel,
      status: item.status,
    })),
    nextActions: buildNextActions({
      plan: input.plan,
      task: input.task,
      status,
      diagnostics,
    }),
    diagnostics,
  };

  state.artifacts = [artifact, ...state.artifacts.filter((entry) => entry.id !== artifact.id)].slice(0, 500);
  writeArtifactState(state);

  FluxRecorder.record({
    traceID: artifact.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.research.artifact",
    status: artifact.status === "failed" ? "error" : "ok",
    method: existing ? "update" : "create",
    path: artifact.kind,
    route: artifact.id,
    metadata: {
      executionId: artifact.executionId,
      planId: artifact.planId,
      taskId: artifact.taskId,
      workflow: artifact.workflow,
      status: artifact.status,
      diagnosticCount: artifact.diagnostics.length,
      citationCount: artifact.citations.length,
    },
  });

  for (const diagnostic of artifact.diagnostics) {
    FluxRecorder.record({
      traceID: artifact.id,
      direction: "internal",
      domain: "investing",
      kind: "investing.research.diagnostic",
      status: diagnostic.severity === "error" ? "error" : "ok",
      method: "emit",
      path: diagnostic.toolId ?? artifact.taskId,
      route: diagnostic.id,
      metadata: {
        artifactId: artifact.id,
        executionId: artifact.executionId,
        planId: artifact.planId,
        taskId: artifact.taskId,
        summary: diagnostic.summary,
        operatorAction: diagnostic.operatorAction,
        command: diagnostic.command,
      },
    });
  }

  return artifact;
}

export function getInvestingResearchArtifact(artifactId: string): InvestingResearchArtifact | null {
  const state = readArtifactState();
  return state.artifacts.find((artifact) => artifact.id === artifactId) ?? null;
}

export function listInvestingResearchArtifacts(options?: {
  planId?: string;
  taskId?: string;
  executionId?: string;
  status?: InvestingResearchArtifactStatus;
  limit?: number;
}): InvestingResearchArtifact[] {
  const state = readArtifactState();
  return state.artifacts
    .filter((artifact) => (options?.planId ? artifact.planId === options.planId : true))
    .filter((artifact) => (options?.taskId ? artifact.taskId === options.taskId : true))
    .filter((artifact) => (options?.executionId ? artifact.executionId === options.executionId : true))
    .filter((artifact) => (options?.status ? artifact.status === options.status : true))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, options?.limit ?? 20);
}
