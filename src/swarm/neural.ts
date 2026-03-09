/**
 * Neural Pattern Training for Learning
 *
 * Learns from successful task completions to improve future performance.
 * Stores patterns in memory MCP for retrieval during similar tasks.
 */

import { Queen } from "./queen";
import type { SwarmResult } from "./types";

export interface Pattern {
  id: string;
  type: "success" | "failure" | "approach";
  task: string;
  context: string;
  outcome: string;
  confidence: number;
  createdAt: Date;
}

export interface TrainingResult {
  patternsLearned: number;
  patternsReinforced: number;
  confidence: number;
}

/**
 * Extract patterns from a successful task completion
 */
export async function learnFromSuccess(
  task: string,
  result: SwarmResult,
  context?: string
): Promise<Pattern[]> {
  const patterns: Pattern[] = [];

  if (!result.success) {
    return patterns;
  }

  // Extract approach pattern from each worker
  for (const worker of result.workers) {
    if (worker.status === "completed" && worker.output.length > 0) {
      patterns.push({
        id: `pattern-${worker.id}-${Date.now()}`,
        type: "success",
        task,
        context: context ?? "",
        outcome: worker.output.join("").slice(0, 2000), // Limit size
        confidence: 0.8,
        createdAt: new Date(),
      });
    }
  }

  return patterns;
}

/**
 * Extract patterns from a failed task for future avoidance
 */
export async function learnFromFailure(
  task: string,
  result: SwarmResult,
  context?: string
): Promise<Pattern[]> {
  const patterns: Pattern[] = [];

  for (const worker of result.workers) {
    if (worker.status === "failed" && worker.error) {
      patterns.push({
        id: `pattern-${worker.id}-${Date.now()}`,
        type: "failure",
        task,
        context: context ?? "",
        outcome: worker.error,
        confidence: 0.9, // High confidence to avoid
        createdAt: new Date(),
      });
    }
  }

  return patterns;
}

/**
 * Train on a batch of completed tasks
 */
export async function trainOnBatch(
  tasks: Array<{ task: string; result: SwarmResult; context?: string }>
): Promise<TrainingResult> {
  let patternsLearned = 0;
  let patternsReinforced = 0;
  const allPatterns: Pattern[] = [];

  for (const { task, result, context } of tasks) {
    if (result.success) {
      const successPatterns = await learnFromSuccess(task, result, context);
      allPatterns.push(...successPatterns);
      patternsLearned += successPatterns.length;
    } else {
      const failurePatterns = await learnFromFailure(task, result, context);
      allPatterns.push(...failurePatterns);
      patternsLearned += failurePatterns.length;
    }
  }

  // Calculate overall confidence
  const avgConfidence =
    allPatterns.length > 0
      ? allPatterns.reduce((sum, p) => sum + p.confidence, 0) / allPatterns.length
      : 0;

  return {
    patternsLearned,
    patternsReinforced,
    confidence: avgConfidence,
  };
}

/**
 * Find similar patterns for a new task
 */
export async function findSimilarPatterns(
  task: string,
  limit: number = 5
): Promise<Pattern[]> {
  // This would query the memory MCP for similar patterns
  // For now, return empty - actual implementation needs MCP integration
  return [];
}

/**
 * Apply learned patterns to enhance a task prompt
 */
export async function enhanceWithPatterns(
  task: string,
  context?: string
): Promise<string> {
  const patterns = await findSimilarPatterns(task);

  if (patterns.length === 0) {
    return task;
  }

  const successPatterns = patterns.filter((p) => p.type === "success");
  const failurePatterns = patterns.filter((p) => p.type === "failure");

  let enhanced = task;

  if (successPatterns.length > 0) {
    enhanced += "\n\n## Successful Approaches (from similar tasks)\n";
    for (const p of successPatterns.slice(0, 3)) {
      enhanced += `- ${p.outcome.slice(0, 200)}...\n`;
    }
  }

  if (failurePatterns.length > 0) {
    enhanced += "\n\n## Approaches to Avoid\n";
    for (const p of failurePatterns.slice(0, 2)) {
      enhanced += `- Failed: ${p.outcome}\n`;
    }
  }

  return enhanced;
}

/**
 * Run a task with neural enhancement (Learning-only)
 */
export async function runWithLearning(
  task: string,
  agent: "learning" = "learning"
): Promise<SwarmResult> {
  // Enhance task with learned patterns
  const enhancedTask = await enhanceWithPatterns(task);

  // Run the task
  const queen = new Queen({ panes: true, maxWorkers: 1 });
  const result = await queen.spawn([
    {
      id: "neural-task",
      name: "Neural-Enhanced",
      prompt: enhancedTask,
      agent,
    },
  ]);

  // Learn from the result
  if (result.success) {
    await learnFromSuccess(task, result);
  } else {
    await learnFromFailure(task, result);
  }

  return result;
}
