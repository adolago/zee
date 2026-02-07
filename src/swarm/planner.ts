/**
 * Lightweight Planning Module
 *
 * Allows personas to decompose complex requests into tracked steps,
 * persist plan state across sessions, and proactively continue work.
 */

import { randomUUID } from "node:crypto";
import { getMemory } from "../memory/unified.js";
import { Log } from "../../packages/agent-core/src/util/log";

const log = Log.create({ service: "swarm:planner" });

// =============================================================================
// Types
// =============================================================================

export interface PlanStep {
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
}

export interface Plan {
  id: string;
  persona: string;
  objective: string;
  steps: PlanStep[];
  status: "active" | "completed" | "abandoned";
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
}

// =============================================================================
// In-memory plan cache (backed by Qdrant for persistence)
// =============================================================================

const planCache = new Map<string, Plan>();

// =============================================================================
// Plan Operations
// =============================================================================

/**
 * Create a new plan and persist it to memory.
 */
export async function createPlan(
  persona: string,
  objective: string,
  steps: string[],
  sessionId?: string,
): Promise<Plan> {
  const plan: Plan = {
    id: randomUUID(),
    persona,
    objective,
    steps: steps.map((description) => ({
      description,
      status: "pending" as const,
    })),
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionId,
  };

  planCache.set(plan.id, plan);
  await persistPlan(plan);

  log.info("Plan created", { id: plan.id, persona, steps: steps.length });
  return plan;
}

/**
 * Advance a plan: mark the current in-progress step as completed (with optional result),
 * and move the next pending step to in_progress. If all steps are done, mark the plan completed.
 */
export async function advancePlan(
  planId: string,
  result?: string,
): Promise<{ plan: Plan; nextStep?: PlanStep; completed: boolean }> {
  const plan = await getPlan(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);
  if (plan.status !== "active") throw new Error(`Plan is ${plan.status}, cannot advance`);

  // Find and complete current in-progress step
  const currentStep = plan.steps.find((s) => s.status === "in_progress");
  if (currentStep) {
    currentStep.status = "completed";
    currentStep.result = result;
  }

  // Find next pending step and start it
  const nextStep = plan.steps.find((s) => s.status === "pending");
  if (nextStep) {
    nextStep.status = "in_progress";
  }

  // Check if all steps are done
  const allDone = plan.steps.every(
    (s) => s.status === "completed" || s.status === "failed",
  );
  if (allDone) {
    plan.status = "completed";
  }

  plan.updatedAt = Date.now();
  planCache.set(plan.id, plan);
  await persistPlan(plan);

  log.info("Plan advanced", {
    id: plan.id,
    completed: allDone,
    nextStep: nextStep?.description,
  });

  return { plan, nextStep, completed: allDone };
}

/**
 * Mark a step as failed and optionally provide an error description.
 */
export async function failStep(
  planId: string,
  error: string,
): Promise<Plan> {
  const plan = await getPlan(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);

  const currentStep = plan.steps.find((s) => s.status === "in_progress");
  if (currentStep) {
    currentStep.status = "failed";
    currentStep.result = error;
  }

  plan.updatedAt = Date.now();
  planCache.set(plan.id, plan);
  await persistPlan(plan);

  return plan;
}

/**
 * Retrieve a plan by ID, checking cache first then memory.
 */
export async function getPlan(planId: string): Promise<Plan | null> {
  // Check cache first
  const cached = planCache.get(planId);
  if (cached) return cached;

  // Try loading from memory
  try {
    const store = getMemory();
    const results = await store.agenticSearch({
      domain: "system",
      topic: "plans",
      query: planId,
      namespace: "zee",
      limit: 1,
    });

    if (results.length > 0) {
      const entry = results[0].entry;
      try {
        const plan = JSON.parse(entry.content) as Plan;
        planCache.set(plan.id, plan);
        return plan;
      } catch {
        return null;
      }
    }
  } catch (error) {
    log.debug("Failed to load plan from memory", {
      planId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}

/**
 * List active plans for a persona.
 */
export async function listPlans(
  persona: string,
  options?: { status?: Plan["status"]; limit?: number },
): Promise<Plan[]> {
  const plans: Plan[] = [];

  // Check cache first
  for (const plan of planCache.values()) {
    if (plan.persona === persona) {
      if (!options?.status || plan.status === options.status) {
        plans.push(plan);
      }
    }
  }

  // Also search memory for plans not in cache
  try {
    const store = getMemory();
    const results = await store.agenticSearch({
      domain: "system",
      topic: "plans",
      namespace: "zee",
      limit: options?.limit ?? 20,
    });

    for (const r of results) {
      try {
        const plan = JSON.parse(r.entry.content) as Plan;
        if (plan.persona !== persona) continue;
        if (options?.status && plan.status !== options.status) continue;
        if (!planCache.has(plan.id)) {
          planCache.set(plan.id, plan);
          plans.push(plan);
        }
      } catch {
        // Skip malformed entries
      }
    }
  } catch {
    // Memory unavailable, return cache-only results
  }

  return plans.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, options?.limit ?? 20);
}

/**
 * Abandon a plan (mark it as abandoned).
 */
export async function abandonPlan(planId: string): Promise<Plan> {
  const plan = await getPlan(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);

  plan.status = "abandoned";
  plan.updatedAt = Date.now();
  planCache.set(plan.id, plan);
  await persistPlan(plan);

  return plan;
}

// =============================================================================
// Persistence Helpers
// =============================================================================

async function persistPlan(plan: Plan): Promise<void> {
  try {
    const store = getMemory();
    await store.save({
      category: "task",
      content: JSON.stringify(plan),
      namespace: "zee",
      domain: "system",
      topic: "plans",
      subtopic: plan.persona,
      memoryId: `plan-${plan.id}`,
      kind: "agent",
      priority: plan.status === "active" ? "high" : "normal",
      metadata: {
        agent: plan.persona,
        tags: ["plan", plan.status],
        extra: {
          planId: plan.id,
          objective: plan.objective,
          stepCount: plan.steps.length,
        },
      },
    });
  } catch (error) {
    log.debug("Failed to persist plan to memory", {
      planId: plan.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Format a plan for display.
 */
export function formatPlan(plan: Plan): string {
  const statusIcon: Record<PlanStep["status"], string> = {
    pending: "[ ]",
    in_progress: "[>]",
    completed: "[x]",
    failed: "[!]",
  };

  const steps = plan.steps
    .map((s, i) => {
      const icon = statusIcon[s.status];
      const result = s.result ? ` -- ${s.result.slice(0, 100)}` : "";
      return `  ${i + 1}. ${icon} ${s.description}${result}`;
    })
    .join("\n");

  return `Plan: ${plan.objective} (${plan.status})
ID: ${plan.id}
Persona: ${plan.persona}
Steps:
${steps}`;
}
