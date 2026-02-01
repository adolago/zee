/**
 * SPARC Phases for Johny
 *
 * Enforced development methodology:
 * - Specification: Define requirements clearly
 * - Pseudocode: Outline logic before coding
 * - Architecture: Design component structure
 * - Refinement: Iterate on implementation
 * - Completion: Test and document
 *
 * Only Johny uses this for development tasks.
 */

import { Queen } from "./queen";
import { WorkerConfig, SwarmResult } from "./types";

export type SparcPhase = "specification" | "pseudocode" | "architecture" | "refinement" | "completion";

export interface SparcTask {
  description: string;
  context?: string;
  files?: string[];
}

export interface SparcConfig {
  parallel?: boolean; // Run phases in parallel where possible
  panes?: boolean;
}

const PHASE_PROMPTS: Record<SparcPhase, (task: SparcTask) => string> = {
  specification: (task) => `
SPARC Phase: SPECIFICATION

Task: ${task.description}
${task.context ? `Context: ${task.context}` : ""}
${task.files?.length ? `Files: ${task.files.join(", ")}` : ""}

Your job:
1. Define clear, testable requirements
2. Identify acceptance criteria
3. List constraints and assumptions
4. Define scope boundaries
5. Identify dependencies

Output a structured specification document.
`.trim(),

  pseudocode: (task) => `
SPARC Phase: PSEUDOCODE

Task: ${task.description}
${task.context ? `Context: ${task.context}` : ""}

Your job:
1. Outline the algorithm in plain language
2. Define data structures needed
3. Identify edge cases
4. Write pseudocode for core logic
5. Note complexity considerations

Output pseudocode that can guide implementation.
`.trim(),

  architecture: (task) => `
SPARC Phase: ARCHITECTURE

Task: ${task.description}
${task.context ? `Context: ${task.context}` : ""}
${task.files?.length ? `Existing files: ${task.files.join(", ")}` : ""}

Your job:
1. Design component structure
2. Define interfaces between components
3. Choose appropriate patterns
4. Plan file organization
5. Consider extensibility and testing

Output an architecture document with diagrams (mermaid).
`.trim(),

  refinement: (task) => `
SPARC Phase: REFINEMENT

Task: ${task.description}
${task.context ? `Context: ${task.context}` : ""}
${task.files?.length ? `Files to modify: ${task.files.join(", ")}` : ""}

Your job:
1. Implement the solution following the architecture
2. Write tests first (TDD)
3. Refactor for clarity
4. Handle edge cases
5. Optimize if needed

Make the changes and verify they work.
`.trim(),

  completion: (task) => `
SPARC Phase: COMPLETION

Task: ${task.description}
${task.context ? `Context: ${task.context}` : ""}

Your job:
1. Run all tests and fix failures
2. Update documentation
3. Review code for quality
4. Check for security issues
5. Prepare for commit

Finalize the implementation.
`.trim(),
};

/**
 * Run a single SPARC phase
 */
export async function runPhase(
  phase: SparcPhase,
  task: SparcTask,
  config?: SparcConfig
): Promise<SwarmResult> {
  const queen = new Queen({
    panes: config?.panes ?? true,
    maxWorkers: 1,
  });

  const prompt = PHASE_PROMPTS[phase](task);

  return queen.spawn([
    {
      id: `sparc-${phase}`,
      name: `SPARC-${phase.charAt(0).toUpperCase() + phase.slice(1)}`,
      prompt,
      persona: "johny",
    },
  ]);
}

/**
 * Run full SPARC pipeline sequentially
 */
export async function runSparcPipeline(
  task: SparcTask,
  config?: SparcConfig
): Promise<Map<SparcPhase, SwarmResult>> {
  const phases: SparcPhase[] = [
    "specification",
    "pseudocode",
    "architecture",
    "refinement",
    "completion",
  ];

  const results = new Map<SparcPhase, SwarmResult>();
  let context = task.context ?? "";

  for (const phase of phases) {
    // Accumulate context from previous phases
    const phaseTask: SparcTask = {
      ...task,
      context: context,
    };

    const result = await runPhase(phase, phaseTask, config);
    results.set(phase, result);

    // Add this phase's output to context for next phase
    if (result.success && result.workers[0]?.output.length > 0) {
      context += `\n\n--- ${phase.toUpperCase()} OUTPUT ---\n`;
      context += result.workers[0].output.join("");
    }
  }

  return results;
}

/**
 * Run SPARC with parallel early phases
 * Spec + Pseudocode + Architecture can run in parallel
 * Refinement + Completion must be sequential
 */
export async function runSparcParallel(
  task: SparcTask,
  config?: SparcConfig
): Promise<Map<SparcPhase, SwarmResult>> {
  const results = new Map<SparcPhase, SwarmResult>();

  // Phase 1: Run spec, pseudocode, architecture in parallel
  const queen = new Queen({
    panes: config?.panes ?? true,
    maxWorkers: 3,
  });

  const earlyPhases: SparcPhase[] = ["specification", "pseudocode", "architecture"];
  const earlyConfigs: WorkerConfig[] = earlyPhases.map((phase) => ({
    id: `sparc-${phase}`,
    name: `SPARC-${phase.charAt(0).toUpperCase() + phase.slice(1)}`,
    prompt: PHASE_PROMPTS[phase](task),
    persona: "johny" as const,
  }));

  const earlyResult = await queen.spawn(earlyConfigs);

  // Store individual results
  earlyResult.workers.forEach((worker, index) => {
    results.set(earlyPhases[index], {
      id: worker.id,
      workers: [worker],
      duration: earlyResult.duration,
      success: worker.status === "completed",
    });
  });

  // Build context from early phases
  let context = task.context ?? "";
  for (const phase of earlyPhases) {
    const phaseResult = results.get(phase);
    if (phaseResult?.success && phaseResult.workers[0]?.output.length > 0) {
      context += `\n\n--- ${phase.toUpperCase()} OUTPUT ---\n`;
      context += phaseResult.workers[0].output.join("");
    }
  }

  // Phase 2: Run refinement and completion sequentially
  for (const phase of ["refinement", "completion"] as SparcPhase[]) {
    const phaseTask: SparcTask = { ...task, context };
    const result = await runPhase(phase, phaseTask, config);
    results.set(phase, result);

    if (result.success && result.workers[0]?.output.length > 0) {
      context += `\n\n--- ${phase.toUpperCase()} OUTPUT ---\n`;
      context += result.workers[0].output.join("");
    }
  }

  return results;
}
