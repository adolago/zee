/**
 * Investing Research Workflow Planner
 *
 * Creates repeatable multi-step research plans for Stanley-style workflows,
 * persists them locally, and emits telemetry for operator visibility.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FluxRecorder } from "../../../packages/zee/src/flux";
import { Log } from "../../../packages/zee/src/util/log";

const log = Log.create({ service: "investing:research-planner" });

export const INVESTING_RESEARCH_WORKFLOW_KINDS = [
  "company-brief",
  "earnings-preview",
  "earnings-review",
  "thesis-refresh",
  "valuation-refresh",
  "event-follow-up",
  "peer-compare",
] as const;

export type InvestingResearchWorkflowKind = (typeof INVESTING_RESEARCH_WORKFLOW_KINDS)[number];

export const INVESTING_RESEARCH_TASK_PHASES = ["intake", "data", "analysis", "synthesis"] as const;

export type InvestingResearchTaskPhase = (typeof INVESTING_RESEARCH_TASK_PHASES)[number];

export const INVESTING_RESEARCH_PLAN_STATUSES = ["active", "completed", "blocked"] as const;

export type InvestingResearchPlanStatus = (typeof INVESTING_RESEARCH_PLAN_STATUSES)[number];

export const INVESTING_RESEARCH_TASK_STATUSES = ["pending", "in_progress", "completed", "blocked"] as const;

export type InvestingResearchTaskStatus = (typeof INVESTING_RESEARCH_TASK_STATUSES)[number];

export interface InvestingResearchTask {
  id: string;
  phase: InvestingResearchTaskPhase;
  title: string;
  description: string;
  toolIds: string[];
  dependsOn: string[];
  deliverable: string;
  status: InvestingResearchTaskStatus;
  note?: string;
}

export interface InvestingResearchPlan {
  id: string;
  objective: string;
  workflow: InvestingResearchWorkflowKind;
  symbols: string[];
  status: InvestingResearchPlanStatus;
  createdAt: string;
  updatedAt: string;
  tasks: InvestingResearchTask[];
}

type PlannerState = {
  version: 1;
  plans: InvestingResearchPlan[];
};

export type CreateInvestingResearchPlanInput = {
  objective: string;
  workflow?: InvestingResearchWorkflowKind;
  symbols?: string[];
};

export type UpdateInvestingResearchTaskInput = {
  planId: string;
  taskId: string;
  status: InvestingResearchTaskStatus;
  note?: string;
};

function getPlannerStateDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee");
  return path.join(stateDir, "investing");
}

export function getInvestingResearchPlanStateFile(): string {
  return path.join(getPlannerStateDir(), "research-plans.json");
}

function ensurePlannerStateDir(): void {
  mkdirSync(getPlannerStateDir(), { recursive: true });
}

function readPlannerState(): PlannerState {
  const filePath = getInvestingResearchPlanStateFile();
  if (!existsSync(filePath)) {
    return { version: 1, plans: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as PlannerState;
    return {
      version: 1,
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
    };
  } catch (error) {
    log.warn("failed to read research planner state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { version: 1, plans: [] };
  }
}

function writePlannerState(state: PlannerState): void {
  ensurePlannerStateDir();
  writeFileSync(getInvestingResearchPlanStateFile(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function normalizeSymbols(symbols?: string[]): string[] {
  const inferred = (symbols ?? [])
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol));

  return Array.from(new Set(inferred));
}

function extractSymbolsFromObjective(objective: string): string[] {
  const matches = objective.match(/\b[A-Z]{1,5}(?:\.[A-Z])?\b/g) ?? [];
  return normalizeSymbols(matches);
}

export function inferInvestingResearchWorkflow(
  objective: string,
  explicit?: InvestingResearchWorkflowKind,
): InvestingResearchWorkflowKind {
  if (explicit) return explicit;

  const normalized = objective.toLowerCase();
  if (normalized.includes("earnings") && (normalized.includes("preview") || normalized.includes("pre-earnings"))) {
    return "earnings-preview";
  }
  if (normalized.includes("peer") || normalized.includes("compare") || normalized.includes("comp")) {
    return "peer-compare";
  }
  if (
    normalized.includes("earnings") &&
    (/\breview\b/.test(normalized) || normalized.includes("reaction") || /\bpost\b/.test(normalized))
  ) {
    return "earnings-review";
  }
  if (normalized.includes("earnings") || normalized.includes("preview")) {
    return "earnings-preview";
  }
  if (normalized.includes("valuation") || normalized.includes("dcf") || normalized.includes("price target")) {
    return "valuation-refresh";
  }
  if (normalized.includes("event") || normalized.includes("8-k") || normalized.includes("catalyst")) {
    return "event-follow-up";
  }
  if (normalized.includes("thesis") || normalized.includes("refresh")) {
    return "thesis-refresh";
  }
  return "company-brief";
}

function buildTask(input: {
  id: string;
  phase: InvestingResearchTaskPhase;
  title: string;
  description: string;
  toolIds: string[];
  dependsOn?: string[];
  deliverable: string;
}): InvestingResearchTask {
  return {
    id: input.id,
    phase: input.phase,
    title: input.title,
    description: input.description,
    toolIds: input.toolIds,
    dependsOn: input.dependsOn ?? [],
    deliverable: input.deliverable,
    status: "pending",
  };
}

function symbolLabel(symbols: string[]): string {
  return symbols.length > 0 ? symbols.join(", ") : "coverage universe";
}

function baseTasks(symbols: string[]): InvestingResearchTask[] {
  const scope = symbolLabel(symbols);
  return [
    buildTask({
      id: "coverage-check",
      phase: "intake",
      title: "Confirm research scope and fresh data coverage",
      description: `Verify ingestion health, entity coverage, and primary symbols for ${scope}.`,
      toolIds: ["zee:invest-status", "zee:invest-scratchpad"],
      deliverable: "Open research session with symbols, gaps, and dependencies logged.",
    }),
    buildTask({
      id: "source-refresh",
      phase: "data",
      title: "Pull primary source delta",
      description: `Collect the latest filings, research context, and recent data changes for ${scope}.`,
      toolIds: ["zee:invest-sec-filings", "zee:invest-research"],
      dependsOn: ["coverage-check"],
      deliverable: "Primary source delta captured with timestamps and source notes.",
    }),
  ];
}

function companyBriefTasks(symbols: string[]): InvestingResearchTask[] {
  const scope = symbolLabel(symbols);
  return [
    ...baseTasks(symbols),
    buildTask({
      id: "business-map",
      phase: "analysis",
      title: "Map business model and segment structure",
      description: `Summarize revenue mix, segment exposure, and business model drivers for ${scope}.`,
      toolIds: ["zee:invest-segments", "zee:invest-research"],
      dependsOn: ["source-refresh"],
      deliverable: "Business map with segment drivers and open questions.",
    }),
    buildTask({
      id: "market-baseline",
      phase: "analysis",
      title: "Establish market and estimate baseline",
      description: `Capture price action, consensus expectations, and baseline financial framing for ${scope}.`,
      toolIds: ["zee:invest-market-data", "zee:invest-estimates"],
      dependsOn: ["source-refresh"],
      deliverable: "Market baseline with price context and estimate anchors.",
    }),
    buildTask({
      id: "brief-synthesis",
      phase: "synthesis",
      title: "Produce company brief",
      description: `Synthesize business, financial, and risk observations into a concise research brief for ${scope}.`,
      toolIds: ["zee:invest-scratchpad"],
      dependsOn: ["business-map", "market-baseline"],
      deliverable: "Company brief with bull, bear, and follow-up questions.",
    }),
  ];
}

function earningsPreviewTasks(symbols: string[]): InvestingResearchTask[] {
  const scope = symbolLabel(symbols);
  return [
    ...baseTasks(symbols),
    buildTask({
      id: "expectation-map",
      phase: "analysis",
      title: "Map consensus and management setup",
      description: `Capture consensus expectations, management guideposts, and recent estimate changes for ${scope}.`,
      toolIds: ["zee:invest-estimates", "zee:invest-research"],
      dependsOn: ["source-refresh"],
      deliverable: "Expectation map with what the market is already pricing.",
    }),
    buildTask({
      id: "preview-scenarios",
      phase: "analysis",
      title: "Draft bull/base/bear earnings scenarios",
      description: `Define the key debate items, scenario branches, and confirmation signals for ${scope}.`,
      toolIds: ["zee:invest-market-data", "zee:invest-scratchpad"],
      dependsOn: ["expectation-map"],
      deliverable: "Scenario grid with trigger metrics and key questions for the call.",
    }),
    buildTask({
      id: "preview-brief",
      phase: "synthesis",
      title: "Publish earnings preview brief",
      description: `Summarize setup, key questions, and scenario-weighted expectations for ${scope}.`,
      toolIds: ["zee:invest-scratchpad"],
      dependsOn: ["preview-scenarios"],
      deliverable: "Earnings preview brief ready for execution or review.",
    }),
  ];
}

function earningsReviewTasks(symbols: string[]): InvestingResearchTask[] {
  const scope = symbolLabel(symbols);
  return [
    ...baseTasks(symbols),
    buildTask({
      id: "event-capture",
      phase: "analysis",
      title: "Capture earnings release delta",
      description: `Document reported results, management commentary, and disclosed surprises for ${scope}.`,
      toolIds: ["zee:invest-research", "zee:invest-sec-filings"],
      dependsOn: ["source-refresh"],
      deliverable: "Event delta log with reported vs expected differences.",
    }),
    buildTask({
      id: "reaction-check",
      phase: "analysis",
      title: "Measure market and estimate reaction",
      description: `Track price response, estimate revisions, and analyst posture after the release for ${scope}.`,
      toolIds: ["zee:invest-market-data", "zee:invest-estimates"],
      dependsOn: ["event-capture"],
      deliverable: "Reaction snapshot with first-order and second-order moves.",
    }),
    buildTask({
      id: "review-brief",
      phase: "synthesis",
      title: "Publish post-earnings review",
      description: `Update the investment view, debate points, and next watch items for ${scope}.`,
      toolIds: ["zee:invest-scratchpad"],
      dependsOn: ["reaction-check"],
      deliverable: "Post-earnings review with thesis implications and next steps.",
    }),
  ];
}

function thesisRefreshTasks(symbols: string[]): InvestingResearchTask[] {
  const scope = symbolLabel(symbols);
  return [
    ...baseTasks(symbols),
    buildTask({
      id: "thesis-delta",
      phase: "analysis",
      title: "Compare old thesis against new evidence",
      description: `Identify what changed in fundamentals, narrative, and risk posture for ${scope}.`,
      toolIds: ["zee:invest-research", "zee:invest-insider-trades"],
      dependsOn: ["source-refresh"],
      deliverable: "Thesis delta with confirms, breaks, and unresolved items.",
    }),
    buildTask({
      id: "valuation-check",
      phase: "analysis",
      title: "Refresh valuation anchors",
      description: `Update price context and estimate anchors to test whether the thesis still clears the hurdle for ${scope}.`,
      toolIds: ["zee:invest-market-data", "zee:invest-estimates"],
      dependsOn: ["thesis-delta"],
      deliverable: "Valuation check with current hurdle rate and sensitivity notes.",
    }),
    buildTask({
      id: "thesis-refresh-brief",
      phase: "synthesis",
      title: "Write refreshed thesis",
      description: `Produce an updated thesis statement, conviction view, and monitoring plan for ${scope}.`,
      toolIds: ["zee:invest-scratchpad"],
      dependsOn: ["valuation-check"],
      deliverable: "Refreshed thesis with watchpoints and conviction changes.",
    }),
  ];
}

function valuationRefreshTasks(symbols: string[]): InvestingResearchTask[] {
  const scope = symbolLabel(symbols);
  return [
    ...baseTasks(symbols),
    buildTask({
      id: "valuation-inputs",
      phase: "analysis",
      title: "Refresh operating and market inputs",
      description: `Update the valuation baseline with price context, estimates, and the latest primary source data for ${scope}.`,
      toolIds: ["zee:invest-market-data", "zee:invest-estimates", "zee:invest-sec-filings"],
      dependsOn: ["source-refresh"],
      deliverable: "Current valuation input deck with assumptions and source lineage.",
    }),
    buildTask({
      id: "valuation-scenarios",
      phase: "analysis",
      title: "Build scenario valuation ranges",
      description: `Define bull, base, and bear valuation ranges and identify the key assumption sensitivities for ${scope}.`,
      toolIds: ["zee:invest-scratchpad"],
      dependsOn: ["valuation-inputs"],
      deliverable: "Scenario valuation table with upside/downside drivers.",
    }),
    buildTask({
      id: "valuation-brief",
      phase: "synthesis",
      title: "Publish valuation refresh",
      description: `Summarize the revised valuation view, key assumptions, and decision threshold for ${scope}.`,
      toolIds: ["zee:invest-scratchpad"],
      dependsOn: ["valuation-scenarios"],
      deliverable: "Valuation refresh note with action thresholds and caveats.",
    }),
  ];
}

function eventFollowUpTasks(symbols: string[]): InvestingResearchTask[] {
  const scope = symbolLabel(symbols);
  return [
    ...baseTasks(symbols),
    buildTask({
      id: "event-intake",
      phase: "analysis",
      title: "Capture event facts and primary sources",
      description: `Identify what happened, who disclosed it, and which primary sources define the event for ${scope}.`,
      toolIds: ["zee:invest-research", "zee:invest-sec-filings"],
      dependsOn: ["source-refresh"],
      deliverable: "Event fact pattern with primary-source citations.",
    }),
    buildTask({
      id: "impact-map",
      phase: "analysis",
      title: "Map first-order and second-order impacts",
      description: `Assess the operational, financial, and sentiment impact channels created by the event for ${scope}.`,
      toolIds: ["zee:invest-market-data", "zee:invest-research"],
      dependsOn: ["event-intake"],
      deliverable: "Impact map with immediate effects and follow-on implications.",
    }),
    buildTask({
      id: "event-brief",
      phase: "synthesis",
      title: "Publish event follow-up brief",
      description: `Write the updated view, thesis impact, and next monitoring actions for ${scope}.`,
      toolIds: ["zee:invest-scratchpad"],
      dependsOn: ["impact-map"],
      deliverable: "Event follow-up brief with monitoring triggers.",
    }),
  ];
}

function peerCompareTasks(symbols: string[]): InvestingResearchTask[] {
  const scope = symbolLabel(symbols);
  return [
    ...baseTasks(symbols),
    buildTask({
      id: "peer-matrix",
      phase: "analysis",
      title: "Build comparable company matrix",
      description: `Align the peer set, shared metrics, and source coverage for ${scope}.`,
      toolIds: ["zee:invest-market-data", "zee:invest-estimates"],
      dependsOn: ["source-refresh"],
      deliverable: "Comparable matrix with consistent metrics across the peer set.",
    }),
    buildTask({
      id: "differentiators",
      phase: "analysis",
      title: "Identify differentiators and edge cases",
      description: `Highlight the operating, strategic, and valuation differences that matter across ${scope}.`,
      toolIds: ["zee:invest-research", "zee:invest-segments"],
      dependsOn: ["peer-matrix"],
      deliverable: "Differentiator map with why the peer set diverges.",
    }),
    buildTask({
      id: "comparison-brief",
      phase: "synthesis",
      title: "Publish peer comparison brief",
      description: `Write the ranked comparison, relative valuation view, and follow-up questions for ${scope}.`,
      toolIds: ["zee:invest-scratchpad"],
      dependsOn: ["differentiators"],
      deliverable: "Peer comparison brief with ranking logic and next diligence targets.",
    }),
  ];
}

function buildWorkflowTasks(workflow: InvestingResearchWorkflowKind, symbols: string[]): InvestingResearchTask[] {
  switch (workflow) {
    case "earnings-preview":
      return earningsPreviewTasks(symbols);
    case "earnings-review":
      return earningsReviewTasks(symbols);
    case "thesis-refresh":
      return thesisRefreshTasks(symbols);
    case "valuation-refresh":
      return valuationRefreshTasks(symbols);
    case "event-follow-up":
      return eventFollowUpTasks(symbols);
    case "peer-compare":
      return peerCompareTasks(symbols);
    case "company-brief":
    default:
      return companyBriefTasks(symbols);
  }
}

export function buildInvestingResearchPlan(input: CreateInvestingResearchPlanInput): InvestingResearchPlan {
  const workflow = inferInvestingResearchWorkflow(input.objective, input.workflow);
  const symbols = normalizeSymbols(input.symbols?.length ? input.symbols : extractSymbolsFromObjective(input.objective));
  const timestamp = new Date().toISOString();
  const tasks = buildWorkflowTasks(workflow, symbols);
  if (tasks.length > 0) {
    tasks[0].status = "in_progress";
  }

  return {
    id: `research-plan-${randomUUID().slice(0, 12)}`,
    objective: input.objective.trim(),
    workflow,
    symbols,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    tasks,
  };
}

function updatePlanStatus(plan: InvestingResearchPlan): void {
  if (plan.tasks.every((task) => task.status === "completed")) {
    plan.status = "completed";
    return;
  }
  if (plan.tasks.some((task) => task.status === "blocked")) {
    plan.status = "blocked";
    return;
  }
  plan.status = "active";
}

function maybeAdvanceNextTask(plan: InvestingResearchPlan): void {
  if (plan.tasks.some((task) => task.status === "in_progress")) {
    return;
  }

  const completed = new Set(
    plan.tasks.filter((task) => task.status === "completed").map((task) => task.id),
  );
  const nextTask = plan.tasks.find(
    (task) => task.status === "pending" && task.dependsOn.every((dependency) => completed.has(dependency)),
  );
  if (nextTask) {
    nextTask.status = "in_progress";
  }
}

export function createInvestingResearchPlan(input: CreateInvestingResearchPlanInput): InvestingResearchPlan {
  const plan = buildInvestingResearchPlan(input);
  const state = readPlannerState();
  state.plans = [plan, ...state.plans].slice(0, 200);
  writePlannerState(state);

  FluxRecorder.record({
    traceID: plan.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.research.plan",
    status: "ok",
    method: "create",
    path: plan.workflow,
    route: plan.id,
    metadata: {
      objective: plan.objective,
      workflow: plan.workflow,
      symbols: plan.symbols,
      taskCount: plan.tasks.length,
      phases: Array.from(new Set(plan.tasks.map((task) => task.phase))),
    },
  });

  return plan;
}

export function getInvestingResearchPlan(planId: string): InvestingResearchPlan | null {
  const state = readPlannerState();
  return state.plans.find((plan) => plan.id === planId) ?? null;
}

export function listInvestingResearchPlans(options?: {
  status?: InvestingResearchPlanStatus;
  limit?: number;
}): InvestingResearchPlan[] {
  const state = readPlannerState();
  const filtered = options?.status
    ? state.plans.filter((plan) => plan.status === options.status)
    : state.plans;

  return filtered
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, options?.limit ?? 20);
}

export function updateInvestingResearchTask(input: UpdateInvestingResearchTaskInput): InvestingResearchPlan {
  const state = readPlannerState();
  const plan = state.plans.find((entry) => entry.id === input.planId);
  if (!plan) {
    throw new Error(`Research plan not found: ${input.planId}`);
  }

  const task = plan.tasks.find((entry) => entry.id === input.taskId);
  if (!task) {
    throw new Error(`Research task not found: ${input.taskId}`);
  }

  if (input.status === "in_progress") {
    for (const candidate of plan.tasks) {
      if (candidate.id !== input.taskId && candidate.status === "in_progress") {
        candidate.status = "pending";
      }
    }
  }

  task.status = input.status;
  if (input.note) {
    task.note = input.note;
  }

  if (input.status === "completed") {
    maybeAdvanceNextTask(plan);
  }
  updatePlanStatus(plan);
  plan.updatedAt = new Date().toISOString();
  writePlannerState(state);

  FluxRecorder.record({
    traceID: plan.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.research.plan.task",
    status: input.status === "blocked" ? "error" : "ok",
    method: "update",
    path: task.id,
    route: plan.id,
    metadata: {
      workflow: plan.workflow,
      planStatus: plan.status,
      taskId: task.id,
      taskTitle: task.title,
      taskStatus: task.status,
      note: input.note,
      symbols: plan.symbols,
    },
  });

  return plan;
}
