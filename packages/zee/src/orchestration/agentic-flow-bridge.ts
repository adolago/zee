import { randomUUID } from "node:crypto"
import { getAgentDbMemory } from "@/memory/agentdb-service"
import { getHierarchicalMeshCoordinator } from "@/coordination/hierarchical-mesh"

export type AgenticFlowStep = {
  id: string
  title: string
  prompt: string
}

export type AgenticFlowPlan = {
  id: string
  objective: string
  createdAt: number
  steps: AgenticFlowStep[]
}

export type AgenticFlowRunResult = {
  plan: AgenticFlowPlan
  submitted: Array<{
    stepId: string
    taskId?: string
  }>
}

function toSteps(objective: string, maxSteps: number): string[] {
  const cleaned = objective
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/[.;]+/))
    .map((line) => line.replace(/^\s*[-*0-9.)]+\s*/, "").trim())
    .filter(Boolean)

  if (cleaned.length === 0) {
    return ["Clarify objective", "Implement changes", "Summarize outcome"]
  }
  return cleaned.slice(0, Math.max(1, maxSteps))
}

export class AgenticFlowBridge {
  decomposeObjective(objective: string, opts: { maxSteps?: number } = {}): AgenticFlowPlan {
    const maxSteps = opts.maxSteps ?? 6
    const fragments = toSteps(objective, maxSteps)
    const steps: AgenticFlowStep[] = fragments.map((fragment, index) => ({
      id: `step_${index + 1}`,
      title: `Step ${index + 1}`,
      prompt: fragment,
    }))
    return {
      id: `flow_${randomUUID().slice(0, 12)}`,
      objective,
      createdAt: Date.now(),
      steps,
    }
  }

  async runPlan(
    plan: AgenticFlowPlan,
    opts: {
      agent?: "zee"
      orchestrator?: any
    } = {},
  ): Promise<AgenticFlowRunResult> {
    const agent = opts.agent ?? "zee"
    const orchestrator = opts.orchestrator ?? (await this.createOrchestrator())
    const submitted: AgenticFlowRunResult["submitted"] = []

    const mesh = getHierarchicalMeshCoordinator()
    mesh.routeCrossDomainMessage({
      sourceDomain: "zee",
      targetDomain: agent,
      topic: `agentic-flow:${plan.id}`,
    })

    for (const step of plan.steps) {
      const task = await orchestrator.submitTask({
        agent,
        description: `${plan.objective}: ${step.title}`,
        prompt: step.prompt,
        priority: "normal",
      })
      submitted.push({
        stepId: step.id,
        taskId: task.id,
      })
    }

    // Persist the orchestration plan as a memory trace for continuity.
    try {
      const memory = await getAgentDbMemory()
      const save = memory["save"]
      if (typeof save === "function") {
        await save({
          category: "task",
          content: `Agentic flow ${plan.id}: ${plan.objective}`,
          summary: `Submitted ${submitted.length} steps for agent ${agent}`,
          metadata: {
            tags: ["agentic-flow", "v3", agent],
          },
        })
      }
    } catch {
      // Best-effort persistence.
    }

    return {
      plan,
      submitted,
    }
  }

  private async createOrchestrator(): Promise<any> {
    const mod = await import("../../../../src/swarm/orchestrator")
    return new mod.Orchestrator({
      maxWorkers: 15,
      queue: {
        mode: "parallel",
        cap: 100,
        dropPolicy: "summarize",
        dedupeMode: "task-id",
        summaryLimit: 20,
      },
      panes: false,
    })
  }
}
