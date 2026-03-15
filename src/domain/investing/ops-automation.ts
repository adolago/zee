/**
 * Investing Research Ops Automation
 *
 * Registers unattended portfolio and earnings workflows, materializes the
 * resulting briefing or packet content, and persists a complete delivery audit
 * trail for operator review.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FluxRecorder } from "../../../packages/zee/src/flux";
import { Scheduler } from "../../../packages/zee/src/scheduler";
import { Log } from "../../../packages/zee/src/util/log";
import { Instance } from "../../../packages/zee/src/project/instance";
import {
  createInvestingPortfolioBriefing,
  renderInvestingPortfolioBriefing,
} from "./briefings";
import {
  createInvestingEarningsPacket,
  exportInvestingEarningsPacket,
} from "./earnings-packets";
import {
  getInvestingResearchExecution,
  listInvestingResearchExecutions,
} from "./executor";
import { getInvestingResearchPlan } from "./planner";

const log = Log.create({ service: "investing:ops-automation" });

export const INVESTING_OPS_WORKFLOWS = [
  "daily-portfolio-brief",
  "earnings-preview-packet",
  "earnings-review-packet",
] as const;

export type InvestingOpsWorkflow = (typeof INVESTING_OPS_WORKFLOWS)[number];

export const INVESTING_OPS_DELIVERY_TARGETS = ["audit-log"] as const;
export type InvestingOpsDeliveryTarget =
  (typeof INVESTING_OPS_DELIVERY_TARGETS)[number];

export const INVESTING_OPS_FORMATS = ["json", "markdown"] as const;
export type InvestingOpsFormat = (typeof INVESTING_OPS_FORMATS)[number];

export type InvestingOpsRunStatus = "ok" | "error";

export interface InvestingOpsSchedule {
  id: string;
  workflow: InvestingOpsWorkflow;
  enabled: boolean;
  scheduleMinutes: number;
  symbol?: string;
  watchlistSymbols?: string[];
  format: InvestingOpsFormat;
  deliveryTarget: InvestingOpsDeliveryTarget;
  createdAt: string;
  updatedAt: string;
  audit: {
    lastRunAt?: string;
    lastStatus?: InvestingOpsRunStatus;
    lastDeliveryId?: string;
    lastArtifactId?: string;
    lastError?: string;
  };
}

export interface InvestingOpsDeliveryRecord {
  id: string;
  scheduleId: string;
  workflow: InvestingOpsWorkflow;
  status: InvestingOpsRunStatus;
  deliveredAt: string;
  deliveryTarget: InvestingOpsDeliveryTarget;
  format: InvestingOpsFormat;
  artifactKind: "portfolio-briefing" | "earnings-packet";
  artifactId?: string;
  symbol?: string;
  summary: string;
  content: string;
  error?: string;
}

type OpsAutomationState = {
  version: 1;
  schedules: InvestingOpsSchedule[];
  deliveries: InvestingOpsDeliveryRecord[];
};

type CreateInvestingOpsScheduleInput = {
  workflow: InvestingOpsWorkflow;
  scheduleMinutes: number;
  enabled?: boolean;
  symbol?: string;
  watchlistSymbols?: string[];
  format?: InvestingOpsFormat;
  deliveryTarget?: InvestingOpsDeliveryTarget;
};

type UpdateInvestingOpsScheduleInput = {
  scheduleId: string;
  enabled?: boolean;
  scheduleMinutes?: number;
  symbol?: string;
  watchlistSymbols?: string[];
  format?: InvestingOpsFormat;
  deliveryTarget?: InvestingOpsDeliveryTarget;
};

type RegisterTask = typeof Scheduler.register;

function getOpsStateDir(): string {
  const stateDir = process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, "zee")
    : path.join(os.homedir(), ".local", "state", "zee");
  return path.join(stateDir, "investing");
}

export function getInvestingOpsAutomationStateFile(): string {
  return path.join(getOpsStateDir(), "ops-automation.json");
}

function ensureOpsStateDir(): void {
  mkdirSync(getOpsStateDir(), { recursive: true });
}

function readOpsState(): OpsAutomationState {
  const filePath = getInvestingOpsAutomationStateFile();
  if (!existsSync(filePath)) {
    return { version: 1, schedules: [], deliveries: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<OpsAutomationState>;
    return {
      version: 1,
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
      deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries : [],
    };
  } catch (error) {
    log.warn("failed to read ops automation state", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { version: 1, schedules: [], deliveries: [] };
  }
}

function writeOpsState(state: OpsAutomationState): void {
  ensureOpsStateDir();
  writeFileSync(getInvestingOpsAutomationStateFile(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function normalizeSymbol(symbol: string | undefined): string | undefined {
  const normalized = symbol?.trim().toUpperCase();
  return normalized ? normalized : undefined;
}

function uniqueSymbols(symbols?: string[]): string[] | undefined {
  const items = [...new Set((symbols ?? []).map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  return items.length > 0 ? items : undefined;
}

function assertScheduleInput(input: {
  workflow: InvestingOpsWorkflow;
  symbol?: string;
  scheduleMinutes?: number;
}): void {
  if (input.scheduleMinutes != null && (!Number.isFinite(input.scheduleMinutes) || input.scheduleMinutes <= 0)) {
    throw new Error("scheduleMinutes must be a positive integer.");
  }

  if (
    (input.workflow === "earnings-preview-packet" || input.workflow === "earnings-review-packet") &&
    !normalizeSymbol(input.symbol)
  ) {
    throw new Error(`${input.workflow} schedules require a symbol.`);
  }
}

function emitScheduleTelemetry(
  schedule: InvestingOpsSchedule,
  method: "create" | "update" | "scheduler",
  taskId?: string,
): void {
  FluxRecorder.record({
    traceID: schedule.id,
    direction: "internal",
    domain: "investing",
    kind: "investing.ops.schedule",
    status: "ok",
    method,
    path: schedule.workflow,
    route: taskId ?? schedule.id,
    metadata: {
      scheduleId: schedule.id,
      workflow: schedule.workflow,
      scheduleMinutes: schedule.scheduleMinutes,
      enabled: schedule.enabled,
      symbol: schedule.symbol,
      watchlistSymbols: schedule.watchlistSymbols,
      format: schedule.format,
      deliveryTarget: schedule.deliveryTarget,
    },
  });
}

function taskIdForSchedule(scheduleId: string): string {
  return `investing.ops.${scheduleId}`;
}

function renderBriefingContent(input: {
  format: InvestingOpsFormat;
  artifact: Awaited<ReturnType<typeof createInvestingPortfolioBriefing>>;
}): string {
  return input.format === "json"
    ? JSON.stringify(input.artifact, null, 2)
    : renderInvestingPortfolioBriefing(input.artifact);
}

function workflowForScheduleToPlan(
  workflow: InvestingOpsWorkflow,
): "earnings-preview" | "earnings-review" | null {
  switch (workflow) {
    case "earnings-preview-packet":
      return "earnings-preview";
    case "earnings-review-packet":
      return "earnings-review";
    default:
      return null;
  }
}

function artifactKindForWorkflow(
  workflow: InvestingOpsWorkflow,
): "portfolio-briefing" | "earnings-packet" {
  return workflow === "daily-portfolio-brief" ? "portfolio-briefing" : "earnings-packet";
}

function findLatestExecutionForSchedule(schedule: InvestingOpsSchedule): {
  execution: NonNullable<ReturnType<typeof getInvestingResearchExecution>>;
  plan: NonNullable<ReturnType<typeof getInvestingResearchPlan>>;
  taskId: string;
} | null {
  const workflow = workflowForScheduleToPlan(schedule.workflow);
  if (!workflow) return null;

  const symbol = normalizeSymbol(schedule.symbol);
  const candidates = listInvestingResearchExecutions({ limit: 500 })
    .map((execution) => {
      const plan = getInvestingResearchPlan(execution.planId);
      if (!plan) return null;
      const task = plan.tasks.find((entry) => entry.id === execution.taskId);
      if (!task || task.phase !== "synthesis") return null;
      if (plan.workflow !== workflow) return null;
      if (symbol && !plan.symbols.map((item) => item.toUpperCase()).includes(symbol)) return null;
      return { execution, plan, taskId: task.id };
    })
    .filter(
      (
        item,
      ): item is {
        execution: NonNullable<ReturnType<typeof getInvestingResearchExecution>>;
        plan: NonNullable<ReturnType<typeof getInvestingResearchPlan>>;
        taskId: string;
      } => Boolean(item),
    )
    .sort((left, right) => right.execution.finishedAt.localeCompare(left.execution.finishedAt));

  return candidates[0] ?? null;
}

async function materializeSchedule(schedule: InvestingOpsSchedule): Promise<{
  artifactId: string;
  artifactKind: "portfolio-briefing" | "earnings-packet";
  summary: string;
  content: string;
  symbol?: string;
}> {
  switch (schedule.workflow) {
    case "daily-portfolio-brief": {
      const briefing = await createInvestingPortfolioBriefing({
        watchlistSymbols: schedule.watchlistSymbols,
      });
      return {
        artifactId: briefing.id,
        artifactKind: "portfolio-briefing",
        summary: briefing.summary,
        content: renderBriefingContent({ artifact: briefing, format: schedule.format }),
      };
    }
    case "earnings-preview-packet":
    case "earnings-review-packet": {
      const latest = findLatestExecutionForSchedule(schedule);
      if (!latest) {
        throw new Error(`No matching research execution found for ${schedule.workflow}${schedule.symbol ? ` (${schedule.symbol})` : ""}.`);
      }

      const task = latest.plan.tasks.find((entry) => entry.id === latest.taskId);
      if (!task) {
        throw new Error(`Research task context not found for execution: ${latest.execution.id}`);
      }

      const packet = await createInvestingEarningsPacket({
        execution: latest.execution,
        plan: latest.plan,
        task,
      });
      const exported =
        schedule.format === "json"
          ? { packet, content: JSON.stringify(packet, null, 2) }
          : exportInvestingEarningsPacket({
              packetId: packet.id,
              format: "markdown",
            });
      return {
        artifactId: packet.id,
        artifactKind: "earnings-packet",
        summary: packet.summary,
        content: exported.content,
        symbol: packet.symbol,
      };
    }
  }
}

export function createInvestingOpsSchedule(
  input: CreateInvestingOpsScheduleInput,
): InvestingOpsSchedule {
  assertScheduleInput({
    workflow: input.workflow,
    symbol: input.symbol,
    scheduleMinutes: input.scheduleMinutes,
  });

  const now = new Date().toISOString();
  const schedule: InvestingOpsSchedule = {
    id: `investing-ops-schedule-${randomUUID().slice(0, 12)}`,
    workflow: input.workflow,
    enabled: input.enabled ?? true,
    scheduleMinutes: Math.floor(input.scheduleMinutes),
    symbol: normalizeSymbol(input.symbol),
    watchlistSymbols: uniqueSymbols(input.watchlistSymbols),
    format: input.format ?? "markdown",
    deliveryTarget: input.deliveryTarget ?? "audit-log",
    createdAt: now,
    updatedAt: now,
    audit: {},
  };

  const state = readOpsState();
  state.schedules = [schedule, ...state.schedules.filter((entry) => entry.id !== schedule.id)];
  writeOpsState(state);
  emitScheduleTelemetry(schedule, "create");
  return schedule;
}

export function updateInvestingOpsSchedule(
  input: UpdateInvestingOpsScheduleInput,
): InvestingOpsSchedule {
  const state = readOpsState();
  const existing = state.schedules.find((schedule) => schedule.id === input.scheduleId);
  if (!existing) {
    throw new Error(`Ops schedule not found: ${input.scheduleId}`);
  }

  const next: InvestingOpsSchedule = {
    ...existing,
    enabled: input.enabled ?? existing.enabled,
    scheduleMinutes: input.scheduleMinutes != null ? Math.floor(input.scheduleMinutes) : existing.scheduleMinutes,
    symbol: input.symbol !== undefined ? normalizeSymbol(input.symbol) : existing.symbol,
    watchlistSymbols:
      input.watchlistSymbols !== undefined ? uniqueSymbols(input.watchlistSymbols) : existing.watchlistSymbols,
    format: input.format ?? existing.format,
    deliveryTarget: input.deliveryTarget ?? existing.deliveryTarget,
    updatedAt: new Date().toISOString(),
  };

  assertScheduleInput({
    workflow: next.workflow,
    symbol: next.symbol,
    scheduleMinutes: next.scheduleMinutes,
  });

  state.schedules = [next, ...state.schedules.filter((entry) => entry.id !== next.id)];
  writeOpsState(state);
  emitScheduleTelemetry(next, "update");
  return next;
}

export function getInvestingOpsSchedule(scheduleId: string): InvestingOpsSchedule | null {
  const state = readOpsState();
  return state.schedules.find((schedule) => schedule.id === scheduleId) ?? null;
}

export function listInvestingOpsSchedules(options?: {
  workflow?: InvestingOpsWorkflow;
  enabled?: boolean;
  symbol?: string;
  limit?: number;
}): InvestingOpsSchedule[] {
  const symbol = normalizeSymbol(options?.symbol);
  const state = readOpsState();
  return state.schedules
    .filter((schedule) => (options?.workflow ? schedule.workflow === options.workflow : true))
    .filter((schedule) => (typeof options?.enabled === "boolean" ? schedule.enabled === options.enabled : true))
    .filter((schedule) => (symbol ? schedule.symbol === symbol : true))
    .slice(0, options?.limit ?? 20);
}

export async function runInvestingOpsSchedule(input: {
  scheduleId: string;
}): Promise<InvestingOpsDeliveryRecord> {
  const state = readOpsState();
  const schedule = state.schedules.find((entry) => entry.id === input.scheduleId);
  if (!schedule) {
    throw new Error(`Ops schedule not found: ${input.scheduleId}`);
  }

  const deliveredAt = new Date().toISOString();

  try {
    const materialized = await materializeSchedule(schedule);
    const delivery: InvestingOpsDeliveryRecord = {
      id: `investing-ops-delivery-${randomUUID().slice(0, 12)}`,
      scheduleId: schedule.id,
      workflow: schedule.workflow,
      status: "ok",
      deliveredAt,
      deliveryTarget: schedule.deliveryTarget,
      format: schedule.format,
      artifactKind: materialized.artifactKind,
      artifactId: materialized.artifactId,
      symbol: materialized.symbol ?? schedule.symbol,
      summary: materialized.summary,
      content: materialized.content,
    };

    schedule.audit = {
      lastRunAt: deliveredAt,
      lastStatus: "ok",
      lastDeliveryId: delivery.id,
      lastArtifactId: materialized.artifactId,
      lastError: undefined,
    };
    schedule.updatedAt = deliveredAt;

    state.schedules = [schedule, ...state.schedules.filter((entry) => entry.id !== schedule.id)];
    state.deliveries = [delivery, ...state.deliveries].slice(0, 500);
    writeOpsState(state);

    FluxRecorder.record({
      traceID: delivery.id,
      direction: "internal",
      domain: "investing",
      kind: "investing.ops.delivery",
      status: "ok",
      method: "run",
      path: schedule.workflow,
      route: delivery.id,
      metadata: {
        scheduleId: schedule.id,
        artifactKind: delivery.artifactKind,
        artifactId: delivery.artifactId,
        symbol: delivery.symbol,
        deliveryTarget: delivery.deliveryTarget,
        format: delivery.format,
      },
    });

    return delivery;
  } catch (error) {
    const delivery: InvestingOpsDeliveryRecord = {
      id: `investing-ops-delivery-${randomUUID().slice(0, 12)}`,
      scheduleId: schedule.id,
      workflow: schedule.workflow,
      status: "error",
      deliveredAt,
      deliveryTarget: schedule.deliveryTarget,
      format: schedule.format,
      artifactKind: artifactKindForWorkflow(schedule.workflow),
      symbol: schedule.symbol,
      summary: `Delivery failed for ${schedule.workflow}.`,
      content: "",
      error: error instanceof Error ? error.message : String(error),
    };

    schedule.audit = {
      lastRunAt: deliveredAt,
      lastStatus: "error",
      lastDeliveryId: delivery.id,
      lastArtifactId: schedule.audit.lastArtifactId,
      lastError: delivery.error,
    };
    schedule.updatedAt = deliveredAt;

    state.schedules = [schedule, ...state.schedules.filter((entry) => entry.id !== schedule.id)];
    state.deliveries = [delivery, ...state.deliveries].slice(0, 500);
    writeOpsState(state);

    FluxRecorder.record({
      traceID: delivery.id,
      direction: "internal",
      domain: "investing",
      kind: "investing.ops.delivery",
      status: "error",
      method: "run",
      path: schedule.workflow,
      route: delivery.id,
      metadata: {
        scheduleId: schedule.id,
        symbol: delivery.symbol,
        deliveryTarget: delivery.deliveryTarget,
        format: delivery.format,
        error: delivery.error,
      },
    });

    return delivery;
  }
}

export function getInvestingOpsDeliveryRecord(
  deliveryId: string,
): InvestingOpsDeliveryRecord | null {
  const state = readOpsState();
  return state.deliveries.find((delivery) => delivery.id === deliveryId) ?? null;
}

export function listInvestingOpsDeliveryRecords(options?: {
  scheduleId?: string;
  workflow?: InvestingOpsWorkflow;
  status?: InvestingOpsRunStatus;
  symbol?: string;
  limit?: number;
}): InvestingOpsDeliveryRecord[] {
  const symbol = normalizeSymbol(options?.symbol);
  const state = readOpsState();
  return state.deliveries
    .filter((delivery) => (options?.scheduleId ? delivery.scheduleId === options.scheduleId : true))
    .filter((delivery) => (options?.workflow ? delivery.workflow === options.workflow : true))
    .filter((delivery) => (options?.status ? delivery.status === options.status : true))
    .filter((delivery) => (symbol ? delivery.symbol === symbol : true))
    .slice(0, options?.limit ?? 20);
}

export function registerInvestingOpsSchedules(input: {
  directory?: string;
  register?: RegisterTask;
}): Array<{ scheduleId: string; taskId: string; workflow: InvestingOpsWorkflow; scheduleMinutes: number }> {
  const register = input.register ?? Scheduler.register;
  const withDirectory = async <T>(fn: () => Promise<T>) => {
    if (input.directory) {
      return await Instance.provide({
        directory: input.directory,
        fn,
      });
    }
    return await fn();
  };

  const state = readOpsState();
  const registrations: Array<{ scheduleId: string; taskId: string; workflow: InvestingOpsWorkflow; scheduleMinutes: number }> = [];

  for (const schedule of state.schedules) {
    if (!schedule.enabled) continue;
    const taskId = taskIdForSchedule(schedule.id);
    register({
      id: taskId,
      interval: schedule.scheduleMinutes * 60 * 1000,
      scope: "global",
      run: async () => {
        try {
          await withDirectory(async () => await runInvestingOpsSchedule({ scheduleId: schedule.id }));
        } catch (error) {
          log.warn("ops schedule run failed", {
            scheduleId: schedule.id,
            workflow: schedule.workflow,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
    emitScheduleTelemetry(schedule, "scheduler", taskId);
    registrations.push({
      scheduleId: schedule.id,
      taskId,
      workflow: schedule.workflow,
      scheduleMinutes: schedule.scheduleMinutes,
    });
  }

  return registrations;
}
