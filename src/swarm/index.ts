/**
 * Swarm Module
 *
 * Lightweight swarm coordination extracted from Tiara.
 * Provides Claude-Flow-level parallelism without the complexity.
 *
 * Features:
 * - Queen coordinator spawns N workers in parallel
 * - Workers stream output in real-time
 * - WezTerm panes for visual monitoring
 * - Shared memory via Memory MCP
 * - Abort/redirect capabilities
 * - Event-driven coordination
 *
 * Usage:
 * ```ts
 * import { Queen, runSwarm, fanOut, research } from "./swarm";
 *
 * // Simple parallel execution
 * const result = await runSwarm([
 *   { name: "Auth", prompt: "Audit the auth system" },
 *   { name: "API", prompt: "Review API endpoints" },
 *   { name: "Tests", prompt: "Check test coverage" },
 * ]);
 *
 * // Fan-out pattern
 * const result = await fanOut(
 *   "Analyze this file for issues",
 *   [file1Contents, file2Contents, file3Contents]
 * );
 *
 * // Full control with Queen
 * const queen = new Queen({ panes: true, maxWorkers: 6 });
 * queen.on("worker:output", (msg) => console.log(msg.data));
 * await queen.spawn(workerConfigs);
 * ```
 */

export { Queen, runSwarm, fanOut, research } from "./queen";
export type { QueenConfig, ConsensusConfig, ConsensusResult } from "./queen";

export { Worker } from "./worker";

export {
  isWezTermAvailable,
  splitPane,
  createWorkerPanes,
  closeAllPanes,
} from "./panes";
export type { PaneConfig, PaneHandle } from "./panes";

export type {
  WorkerStatus,
  WorkerConfig,
  WorkerState,
  SwarmConfig,
  SwarmResult,
  WorkerMessage,
} from "./types";

// SPARC methodology (Johny-only)
export {
  runPhase,
  runSparcPipeline,
  runSparcParallel,
} from "./sparc";
export type { SparcPhase, SparcTask, SparcConfig } from "./sparc";

// Neural pattern training (Johny-only)
export {
  learnFromSuccess,
  learnFromFailure,
  trainOnBatch,
  findSimilarPatterns,
  enhanceWithPatterns,
  runWithLearning,
} from "./neural";
export type { Pattern, TrainingResult } from "./neural";

// Planner (multi-step planning with persistence)
export {
  createPlan,
  advancePlan,
  failStep,
  getPlan,
  listPlans,
  abandonPlan,
  formatPlan,
} from "./planner";
export type { Plan, PlanStep } from "./planner";

// Recovery (automatic error recovery strategies)
export {
  suggestRecovery,
  withRetry,
  buildEscalation,
} from "./recovery";
export type { RecoveryStrategy, RecoveryResult, RetryOptions } from "./recovery";
