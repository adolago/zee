/**
 * Personas Orchestrator
 *
 * The main coordinator for the personas layer. Manages:
 * - Worker (queen/drone) lifecycle
 * - Task submission and execution
 * - State persistence to Qdrant
 * - WezTerm pane management
 * - Conversation continuity
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  PersonasOrchestrator,
  PersonasState as TypesPersonasState,
  PersonasConfig,
  PersonasTask,
  PersonasEvent,
  PersonasEventType,
  DroneResult,
  WaitOptions,
  SpawnWithWaitOptions,
  Worker,
  WorkerId,
  WorkerRole,
  PersonaId,
  TaskPriority,
  TaskStatus,
  ConversationState,
} from "./types";
import { Memory, getMemory, type PersonasState } from "../memory/unified";
import { WeztermPaneBridge, createWeztermBridge } from "./wezterm";
import { generateDronePrompt } from "./persona";
import { formatAnnouncement, getDroneWaiter, shouldAnnounce, shutdownDroneWaiter } from "./drone-wait";
import { Log } from "../../packages/agent-core/src/util/log";
import { getTiaraQdrantConfig } from "../config/runtime";
import {
  QDRANT_URL,
  QDRANT_COLLECTION_PERSONAS_STATE,
  QDRANT_COLLECTION_PERSONAS_MEMORY,
  CONTINUITY_MAX_KEY_FACTS,
  CONTINUITY_SUMMARY_THRESHOLD,
  TIMEOUT_DRONE_MS,
} from "../config/constants";

const log = Log.create({ service: "personas-tiara" });
const defaultQdrant = getTiaraQdrantConfig();

/**
 * Default personas layer configuration
 */
const DEFAULT_CONFIG: PersonasConfig = {
  maxDronesPerPersona: 3,
  autoSpawn: true,
  wezterm: {
    enabled: true,
    layout: "horizontal",
    showStatusPane: true,
  },
  qdrant: {
    url: defaultQdrant.url ?? QDRANT_URL,
    apiKey: defaultQdrant.apiKey,
    stateCollection: defaultQdrant.stateCollection ?? QDRANT_COLLECTION_PERSONAS_STATE,
    memoryCollection: defaultQdrant.memoryCollection ?? QDRANT_COLLECTION_PERSONAS_MEMORY,
  },
  continuity: {
    autoSummarize: true,
    summaryThreshold: CONTINUITY_SUMMARY_THRESHOLD,
    maxKeyFacts: CONTINUITY_MAX_KEY_FACTS,
  },
  tiara: {
    enabled: true,
    topology: "auto", // Dynamic topology selection based on task type
    sparcEnabled: false, // SPARC methodology for complex planning
    neuralTrainingEnabled: false, // Neural pattern training for optimization
  },
};

/**
 * Topology types and their use cases:
 * - star: Simple tasks, single coordinator (default for unknown tasks)
 * - mesh: Parallel research tasks, multiple independent workers
 * - hierarchical: Multi-step planning with dependencies
 * - adaptive: Self-optimizing topology that adjusts during execution
 */
type TopologyType = "star" | "mesh" | "hierarchical" | "adaptive";

// =============================================================================
// SPARC Methodology Types
// =============================================================================

/**
 * SPARC phases for structured task execution:
 * - specification: Clarify requirements, define scope and success criteria
 * - pseudocode: High-level algorithm design, break down into steps
 * - architecture: System design decisions, component structure
 * - refinement: Optimize, review, iterate on implementation
 * - completion: Final implementation and verification
 */
type SPARCPhase = "specification" | "pseudocode" | "architecture" | "refinement" | "completion";

interface SPARCPhaseResult {
  phase: SPARCPhase;
  output: string;
  durationMs: number;
  workerId?: WorkerId;
}

interface SPARCWorkflowResult {
  success: boolean;
  phases: SPARCPhaseResult[];
  finalResult?: string;
  error?: string;
  totalDurationMs: number;
}

interface SPARCWorkflowOptions {
  persona: PersonaId;
  task: string;
  prompt: string;
  /** Skip phases for simpler tasks */
  skipPhases?: SPARCPhase[];
  /** Timeout per phase in ms */
  phaseTimeoutMs?: number;
}

/**
 * SPARC phase prompts - augment the base prompt with phase-specific instructions
 */
const SPARC_PHASE_PROMPTS: Record<SPARCPhase, (task: string, context?: string) => string> = {
  specification: (task, context) => `
## SPARC Phase: Specification

Your task is to clarify requirements and define scope for: "${task}"

${context ? `Previous context:\n${context}\n\n` : ""}
Please provide:
1. Clear problem statement
2. Success criteria (what does "done" look like?)
3. Constraints and assumptions
4. Key questions to resolve
5. Scope boundaries (what's in/out)

Output your specification as structured markdown.
`,

  pseudocode: (task, context) => `
## SPARC Phase: Pseudocode

Based on the specification, design a high-level algorithm for: "${task}"

${context ? `Specification:\n${context}\n\n` : ""}
Please provide:
1. Step-by-step algorithm in pseudocode
2. Key data structures needed
3. Main functions/operations
4. Edge cases to handle
5. Complexity analysis (if relevant)

Output clear pseudocode with explanations.
`,

  architecture: (task, context) => `
## SPARC Phase: Architecture

Design the system architecture for: "${task}"

${context ? `Pseudocode design:\n${context}\n\n` : ""}
Please provide:
1. Component diagram (text-based)
2. Data flow between components
3. External dependencies
4. Integration points
5. Scalability considerations

Output structured architecture documentation.
`,

  refinement: (task, context) => `
## SPARC Phase: Refinement

Review and optimize the design for: "${task}"

${context ? `Architecture:\n${context}\n\n` : ""}
Please:
1. Identify potential improvements
2. Review for edge cases
3. Optimize for performance
4. Check for security concerns
5. Simplify where possible

Output refined recommendations.
`,

  completion: (task, context) => `
## SPARC Phase: Completion

Implement the final solution for: "${task}"

${context ? `Refined design:\n${context}\n\n` : ""}
Provide the complete implementation:
1. All necessary code/configuration
2. Tests if applicable
3. Documentation
4. Deployment notes if relevant

Output the complete, working solution.
`,
};

/**
 * Check if a task should use SPARC methodology
 */
function shouldUseSPARC(task: string, config: PersonasConfig): boolean {
  if (!config.tiara.sparcEnabled) return false;

  const desc = task.toLowerCase();

  // Complex tasks benefit from SPARC
  if (
    desc.includes("implement") ||
    desc.includes("design") ||
    desc.includes("architect") ||
    desc.includes("build") ||
    desc.includes("create system") ||
    desc.includes("refactor")
  ) {
    return true;
  }

  // Multi-step tasks benefit from SPARC
  if (
    desc.includes("step by step") ||
    desc.includes("phases") ||
    desc.includes("comprehensive")
  ) {
    return true;
  }

  return false;
}

// =============================================================================
// Neural Pattern Training
// =============================================================================

/**
 * Tracks patterns of successful task executions for optimization.
 * Learns: topology choice, timing, task keywords → success correlation
 */
interface TaskPattern {
  /** Task keyword fingerprint */
  keywords: string[];
  /** Persona that executed */
  persona: PersonaId;
  /** Topology used */
  topology: TopologyType;
  /** Average duration for this pattern */
  avgDurationMs: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Number of samples */
  sampleCount: number;
  /** Last updated */
  updatedAt: number;
}

interface NeuralPatternStore {
  patterns: TaskPattern[];
  version: string;
}

/**
 * Extract keywords from a task description for pattern matching
 */
function extractTaskKeywords(task: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "this", "that",
    "these", "those", "i", "you", "he", "she", "it", "we", "they", "me", "him",
    "her", "us", "them", "my", "your", "his", "its", "our", "their",
  ]);

  return task
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 10); // Limit to top 10 keywords
}

/**
 * Calculate similarity between two keyword sets (Jaccard index)
 */
function keywordSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Neural pattern trainer - learns from successful task executions
 */
class NeuralPatternTrainer {
  private patterns: TaskPattern[] = [];
  private readonly similarityThreshold = 0.5;
  private readonly maxPatterns = 1000;

  /**
   * Load patterns from storage
   */
  async loadPatterns(memory: Memory): Promise<void> {
    try {
      const stored = await memory.search({
        query: "neural_patterns tiara",
        limit: 1,
        tags: ["neural_patterns"],
      });
      if (stored.length > 0 && stored[0].entry.content) {
        const data = JSON.parse(stored[0].entry.content) as NeuralPatternStore;
        this.patterns = data.patterns || [];
        log.debug("Loaded neural patterns", { count: this.patterns.length });
      }
    } catch (error) {
      log.warn("Failed to load neural patterns", { error: String(error) });
    }
  }

  /**
   * Save patterns to storage
   */
  async savePatterns(memory: Memory): Promise<void> {
    try {
      const store: NeuralPatternStore = {
        patterns: this.patterns,
        version: "1.0.0",
      };
      await memory.save({
        category: "note",
        content: JSON.stringify(store),
        summary: "Neural patterns for Tiara orchestration",
        metadata: {
          tags: ["neural_patterns"],
          importance: 0.9,
        },
      });
      log.debug("Saved neural patterns", { count: this.patterns.length });
    } catch (error) {
      log.warn("Failed to save neural patterns", { error: String(error) });
    }
  }

  /**
   * Record a task execution result for learning
   */
  recordExecution(
    task: string,
    persona: PersonaId,
    topology: TopologyType,
    durationMs: number,
    success: boolean
  ): void {
    const keywords = extractTaskKeywords(task);
    if (keywords.length === 0) return;

    // Find similar pattern
    const existingPattern = this.patterns.find(
      p => p.persona === persona &&
           p.topology === topology &&
           keywordSimilarity(p.keywords, keywords) > this.similarityThreshold
    );

    if (existingPattern) {
      // Update existing pattern with running average
      const n = existingPattern.sampleCount;
      existingPattern.avgDurationMs = (existingPattern.avgDurationMs * n + durationMs) / (n + 1);
      existingPattern.successRate = (existingPattern.successRate * n + (success ? 1 : 0)) / (n + 1);
      existingPattern.sampleCount++;
      existingPattern.updatedAt = Date.now();

      // Merge keywords (keep most common)
      const mergedKeywords = [...new Set([...existingPattern.keywords, ...keywords])].slice(0, 10);
      existingPattern.keywords = mergedKeywords;
    } else {
      // Create new pattern
      const newPattern: TaskPattern = {
        keywords,
        persona,
        topology,
        avgDurationMs: durationMs,
        successRate: success ? 1 : 0,
        sampleCount: 1,
        updatedAt: Date.now(),
      };
      this.patterns.push(newPattern);

      // Prune old patterns if over limit
      if (this.patterns.length > this.maxPatterns) {
        // Remove oldest with lowest sample counts
        this.patterns.sort((a, b) => b.sampleCount - a.sampleCount || b.updatedAt - a.updatedAt);
        this.patterns = this.patterns.slice(0, this.maxPatterns);
      }
    }
  }

  /**
   * Suggest optimal topology based on learned patterns
   */
  suggestTopology(task: string, persona: PersonaId): TopologyType | null {
    const keywords = extractTaskKeywords(task);
    if (keywords.length === 0) return null;

    // Find best matching pattern
    let bestMatch: TaskPattern | null = null;
    let bestSimilarity = 0;

    for (const pattern of this.patterns) {
      if (pattern.persona !== persona) continue;
      if (pattern.sampleCount < 3) continue; // Need at least 3 samples
      if (pattern.successRate < 0.7) continue; // Only suggest successful patterns

      const similarity = keywordSimilarity(pattern.keywords, keywords);
      if (similarity > bestSimilarity && similarity > this.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = pattern;
      }
    }

    if (bestMatch) {
      log.debug("Neural pattern match found", {
        topology: bestMatch.topology,
        similarity: bestSimilarity.toFixed(2),
        successRate: bestMatch.successRate.toFixed(2),
        samples: bestMatch.sampleCount,
      });
      return bestMatch.topology;
    }

    return null;
  }

  /**
   * Get stats for debugging
   */
  getStats(): { totalPatterns: number; avgSamples: number; avgSuccessRate: number } {
    if (this.patterns.length === 0) {
      return { totalPatterns: 0, avgSamples: 0, avgSuccessRate: 0 };
    }

    const totalSamples = this.patterns.reduce((sum, p) => sum + p.sampleCount, 0);
    const totalSuccessRate = this.patterns.reduce((sum, p) => sum + p.successRate, 0);

    return {
      totalPatterns: this.patterns.length,
      avgSamples: totalSamples / this.patterns.length,
      avgSuccessRate: totalSuccessRate / this.patterns.length,
    };
  }
}

// Global neural pattern trainer instance
let globalNeuralTrainer: NeuralPatternTrainer | null = null;

function getNeuralTrainer(): NeuralPatternTrainer {
  if (!globalNeuralTrainer) {
    globalNeuralTrainer = new NeuralPatternTrainer();
  }
  return globalNeuralTrainer;
}

// =============================================================================
// Tiara Hooks System
// =============================================================================

/**
 * Hook types for Tiara orchestrator lifecycle
 */
export type TiaraHookType =
  | "beforeSpawn"
  | "afterSpawn"
  | "beforeTask"
  | "afterTask"
  | "beforeSPARC"
  | "afterSPARC"
  | "onError"
  | "onTopologySelected"
  | "onWorkerComplete"
  | "onPatternLearned";

/**
 * Hook context with event-specific data
 */
export interface TiaraHookContext {
  /** Hook type */
  type: TiaraHookType;
  /** Timestamp */
  timestamp: number;
  /** Persona involved */
  persona?: PersonaId;
  /** Worker ID if applicable */
  workerId?: WorkerId;
  /** Task description */
  task?: string;
  /** Topology selected */
  topology?: TopologyType;
  /** SPARC phase if in SPARC workflow */
  sparcPhase?: SPARCPhase;
  /** Success/failure status */
  success?: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  durationMs?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Hook handler function type
 * Can be async, return false to cancel (for "before" hooks)
 */
export type TiaraHookHandler = (context: TiaraHookContext) => void | boolean | Promise<void | boolean>;

/**
 * Registered hook with priority
 */
interface RegisteredHook {
  id: string;
  type: TiaraHookType;
  handler: TiaraHookHandler;
  priority: number;
}

/**
 * Tiara Hooks Manager
 * Allows external code to hook into orchestrator lifecycle events
 */
class TiaraHooksManager {
  private hooks: RegisteredHook[] = [];
  private nextId = 1;

  /**
   * Register a hook
   * @returns Unsubscribe function
   */
  register(type: TiaraHookType, handler: TiaraHookHandler, priority = 0): () => void {
    const id = `hook-${this.nextId++}`;
    const hook: RegisteredHook = { id, type, handler, priority };
    this.hooks.push(hook);

    // Sort by priority (higher priority runs first)
    this.hooks.sort((a, b) => b.priority - a.priority);

    return () => {
      this.hooks = this.hooks.filter(h => h.id !== id);
    };
  }

  /**
   * Execute hooks of a given type
   * For "before" hooks, returns false if any hook cancels
   */
  async execute(context: TiaraHookContext): Promise<boolean> {
    const relevantHooks = this.hooks.filter(h => h.type === context.type);

    for (const hook of relevantHooks) {
      try {
        const result = await hook.handler(context);
        // If a "before" hook returns false, cancel the operation
        if (result === false && context.type.startsWith("before")) {
          log.debug("Hook cancelled operation", { hookId: hook.id, type: context.type });
          return false;
        }
      } catch (error) {
        log.warn("Hook threw error", {
          hookId: hook.id,
          type: context.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return true;
  }

  /**
   * Get registered hooks count by type
   */
  getHookCounts(): Record<TiaraHookType, number> {
    const counts: Partial<Record<TiaraHookType, number>> = {};
    for (const hook of this.hooks) {
      counts[hook.type] = (counts[hook.type] || 0) + 1;
    }
    return counts as Record<TiaraHookType, number>;
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks = [];
  }
}

// Global hooks manager instance
let globalHooksManager: TiaraHooksManager | null = null;

/**
 * Get the global hooks manager
 */
export function getTiaraHooks(): TiaraHooksManager {
  if (!globalHooksManager) {
    globalHooksManager = new TiaraHooksManager();
  }
  return globalHooksManager;
}

/**
 * Register a Tiara hook (convenience function)
 */
export function registerTiaraHook(
  type: TiaraHookType,
  handler: TiaraHookHandler,
  priority = 0
): () => void {
  return getTiaraHooks().register(type, handler, priority);
}

/**
 * Select the optimal topology based on task characteristics
 * Priority: explicit config > neural suggestion > rule-based heuristics
 */
function selectTopology(
  persona: PersonaId,
  taskDescription: string,
  configuredTopology: string,
  useNeuralSuggestion = true
): TopologyType {
  // If explicit topology is configured (not "auto"), use it
  if (configuredTopology !== "auto") {
    return configuredTopology as TopologyType;
  }

  // Try neural pattern suggestion first (if enabled)
  if (useNeuralSuggestion) {
    const trainer = getNeuralTrainer();
    const suggestion = trainer.suggestTopology(taskDescription, persona);
    if (suggestion) {
      log.debug("Using neural topology suggestion", { topology: suggestion, persona });
      return suggestion;
    }
  }

  const desc = taskDescription.toLowerCase();

  // Johny (learning/research) benefits from mesh topology for parallel exploration
  if (persona === "johny") {
    if (desc.includes("research") || desc.includes("learn") || desc.includes("explore")) {
      return "mesh";
    }
    if (desc.includes("curriculum") || desc.includes("study plan")) {
      return "hierarchical";
    }
  }

  // Stanley (investing) uses hierarchical for multi-step analysis
  if (persona === "stanley") {
    if (desc.includes("portfolio") || desc.includes("strategy") || desc.includes("analysis")) {
      return "hierarchical";
    }
    if (desc.includes("backtest") || desc.includes("screen")) {
      return "mesh"; // Parallel processing for backtests
    }
  }

  // Zee (personal assistant) typically uses star for simple tasks
  if (persona === "zee") {
    if (desc.includes("coordinate") || desc.includes("delegate")) {
      return "hierarchical";
    }
    if (desc.includes("search") || desc.includes("find")) {
      return "mesh";
    }
  }

  // Complex multi-step tasks use hierarchical
  if (
    desc.includes("plan") ||
    desc.includes("implement") ||
    desc.includes("step by step") ||
    desc.includes("phases")
  ) {
    return "hierarchical";
  }

  // Parallel/concurrent tasks use mesh
  if (
    desc.includes("parallel") ||
    desc.includes("concurrent") ||
    desc.includes("multiple") ||
    desc.includes("batch")
  ) {
    return "mesh";
  }

  // Uncertain tasks that may need adjustment use adaptive
  if (desc.includes("complex") || desc.includes("unknown") || desc.includes("investigate")) {
    return "adaptive";
  }

  // Default to star for simple, straightforward tasks
  return "star";
}

/**
 * Generate a unique worker ID
 */
function generateWorkerId(): WorkerId {
  return `worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as WorkerId;
}

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Main Personas Orchestrator implementation
 */
export class Orchestrator extends EventEmitter implements PersonasOrchestrator {
  private config: PersonasConfig;
  private memory: Memory;
  private weztermBridge: WeztermPaneBridge;
  private currentState: PersonasState;
  private processes = new Map<WorkerId, ChildProcess>();
  private workerOutputs = new Map<WorkerId, { stdout: string; stderr: string }>();
  private maxOutputChars = 20000;
  private initialized = false;
  private syncInterval?: ReturnType<typeof setInterval>;
  private droneWaiter = getDroneWaiter();
  private neuralTrainer = getNeuralTrainer();
  private hooksManager = getTiaraHooks();

  constructor(config?: Partial<PersonasConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Use unified Memory class instead of separate memory bridge
    this.memory = getMemory({
      qdrant: {
        url: this.config.qdrant.url,
        apiKey: this.config.qdrant.apiKey,
        collection: this.config.qdrant.stateCollection,
      },
      maxKeyFacts: this.config.continuity.maxKeyFacts,
    });
    this.weztermBridge = createWeztermBridge(this.config.wezterm);
    this.currentState = this.createInitialState();
  }

  /**
   * Create initial state
   */
  private createInitialState(): PersonasState {
    return {
      version: "1.0.0",
      workers: [],
      tasks: [],
      lastSyncAt: Date.now(),
      stats: {
        totalTasksCompleted: 0,
        totalDronesSpawned: 0,
        totalTokensUsed: 0,
      },
    };
  }

  /**
   * Initialize the tiara
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const leadPersona = this.resolveLeadPersona();

    // Initialize memory bridge
    await this.memory.init();

    // Load neural patterns if training is enabled
    if (this.config.tiara.neuralTrainingEnabled) {
      await this.neuralTrainer.loadPatterns(this.memory);
    }

    // Try to load existing state
    const existingState = await this.memory.loadState();
    if (existingState) {
      this.currentState = existingState;
      // Clean up any stale workers
      this.currentState.workers = this.currentState.workers.filter(
        (w) => w.status !== "terminated" && w.status !== "error"
      );
    }

    // Ensure a lead persona is always present
    if (!this.currentState.conversation) {
      this.currentState.conversation = {
        sessionId: `session-${Date.now()}`,
        leadPersona,
        summary: "",
        plan: "",
        objectives: [],
        keyFacts: [],
        sessionChain: [],
        updatedAt: Date.now(),
      };
    }
    this.ensureQueenPresence(leadPersona);

    // Set up WezTerm if enabled
    if (this.config.wezterm.enabled) {
      const available = await this.weztermBridge.isAvailable();
      if (available) {
        await this.weztermBridge.setupLayout(this.config.wezterm);
      }
    }

    // Start periodic state sync
    this.syncInterval = setInterval(() => {
      this.saveState().catch((e) => log.error("Failed to save state", { error: String(e) }));
    }, 30000); // Sync every 30 seconds

    this.initialized = true;
    this.emit("initialized");
  }

  private resolveLeadPersona(): PersonaId {
    const requested = (process.env.PERSONAS_LEAD_PERSONA ?? "zee").trim().toLowerCase();
    if (requested === "stanley" || requested === "johny" || requested === "zee") {
      return requested;
    }
    return "zee";
  }

  private ensureQueenPresence(persona: PersonaId): void {
    const existing = this.currentState.workers.find(
      (w) => w.persona === persona && w.role === "queen"
    );
    if (existing) {
      if (existing.status === "terminated" || existing.status === "error") {
        existing.status = "idle";
        existing.lastActivityAt = Date.now();
      }
      return;
    }

    const now = Date.now();
    const worker: Worker = {
      id: `queen-${persona}` as WorkerId,
      persona,
      role: "queen",
      status: "idle",
      createdAt: now,
      lastActivityAt: now,
    };
    this.currentState.workers.push(worker);
  }

  /**
   * Get current state
   */
  state(): PersonasState {
    return { ...this.currentState };
  }

  /**
   * Get conversation state
   */
  conversation(): ConversationState | undefined {
    return this.currentState.conversation;
  }

  /**
   * Set the current plan
   */
  async setPlan(plan: string): Promise<void> {
    if (!this.currentState.conversation) {
      this.currentState.conversation = {
        sessionId: `session-${Date.now()}`,
        leadPersona: "zee",
        summary: "",
        plan,
        objectives: [],
        keyFacts: [],
        sessionChain: [],
        updatedAt: Date.now(),
      };
    } else {
      this.currentState.conversation.plan = plan;
      this.currentState.conversation.updatedAt = Date.now();
    }

    await this.saveState();
    this.emitEvent("state:synced", {});
  }

  /**
   * Add an objective
   */
  async addObjective(objective: string): Promise<void> {
    if (!this.currentState.conversation) {
      this.currentState.conversation = {
        sessionId: `session-${Date.now()}`,
        leadPersona: "zee",
        summary: "",
        plan: "",
        objectives: [objective],
        keyFacts: [],
        sessionChain: [],
        updatedAt: Date.now(),
      };
    } else {
      this.currentState.conversation.objectives.push(objective);
      this.currentState.conversation.updatedAt = Date.now();
    }

    await this.saveState();
  }

  /**
   * Spawn a drone for a task
   */
  async spawnDrone(options: {
    persona: PersonaId;
    task: string;
    prompt: string;
    priority?: TaskPriority;
    contextMemoryIds?: string[];
  }): Promise<Worker> {
    // Check limits - only count active drones
    const personaDrones = this.currentState.workers.filter(
      (w) => w.persona === options.persona &&
             w.role === "drone" &&
             w.status !== "terminated" &&
             w.status !== "error"
    );
    if (personaDrones.length >= this.config.maxDronesPerPersona) {
      throw new Error(
        `Maximum drones (${this.config.maxDronesPerPersona}) reached for ${options.persona}`
      );
    }

    const workerId = generateWorkerId();
    const now = Date.now();

    // Select optimal topology based on task and persona
    const topology = selectTopology(
      options.persona,
      options.task,
      this.config.tiara.topology
    );

    // Execute onTopologySelected hook
    await this.hooksManager.execute({
      type: "onTopologySelected",
      timestamp: now,
      persona: options.persona,
      task: options.task,
      topology,
    });

    log.info("Selected topology for task", {
      persona: options.persona,
      task: options.task.slice(0, 50),
      topology,
      configuredTopology: this.config.tiara.topology,
    });

    // Execute beforeSpawn hook (can cancel)
    const shouldSpawn = await this.hooksManager.execute({
      type: "beforeSpawn",
      timestamp: now,
      persona: options.persona,
      task: options.task,
      topology,
    });

    if (!shouldSpawn) {
      throw new Error("Spawn cancelled by beforeSpawn hook");
    }

    // Create worker record
    const worker: Worker = {
      id: workerId,
      persona: options.persona,
      role: "drone",
      status: "spawning",
      currentTask: options.task,
      createdAt: now,
      lastActivityAt: now,
      metadata: { topology }, // Store selected topology for future reference
    };

    this.currentState.workers.push(worker);
    this.currentState.stats.totalDronesSpawned++;

    // Create WezTerm pane if enabled
    if (this.config.wezterm.enabled) {
      try {
        const paneId = await this.weztermBridge.createWorkerPane(worker);
        worker.paneId = paneId;
      } catch (e) {
        log.warn("Failed to create WezTerm pane", { error: String(e), workerId: worker.id });
      }
    }

    // Generate the drone prompt
    const dronePrompt = generateDronePrompt(options.persona, options.prompt, {
      plan: this.currentState.conversation?.plan,
      objectives: this.currentState.conversation?.objectives,
      keyFacts: this.currentState.conversation?.keyFacts,
    });

    // Spawn the process
    try {
      await this.spawnDroneProcess(worker, dronePrompt);
      worker.status = "working";
      this.emitEvent("worker:spawned", { workerId, persona: options.persona });

      // Execute afterSpawn hook
      await this.hooksManager.execute({
        type: "afterSpawn",
        timestamp: Date.now(),
        persona: options.persona,
        workerId,
        task: options.task,
        topology,
        success: true,
      });
    } catch (e) {
      worker.status = "error";
      this.emitEvent("worker:error", { workerId, error: String(e) });

      // Execute onError hook
      await this.hooksManager.execute({
        type: "onError",
        timestamp: Date.now(),
        persona: options.persona,
        workerId,
        task: options.task,
        error: String(e),
      });

      throw e;
    }

    await this.saveState();
    await this.updateStatusPane();

    return worker;
  }

  /**
   * Spawn actual drone process
   */
  private async spawnDroneProcess(worker: Worker, prompt: string): Promise<void> {
    // If we have a WezTerm pane, send command there
    if (worker.paneId && this.config.wezterm.enabled) {
      await this.weztermBridge.launchClaudeCode(worker.paneId, {
        prompt,
        persona: worker.persona,
      });
      return;
    }

    // Otherwise spawn a background process
    // Use agent-core run with JSON output to avoid TUI/formatting issues
    const child = spawn("agent-core", ["run", prompt, "--agent", worker.persona, "--format", "json"], {
      stdio: ["ignore", "pipe", "pipe"], // Ignore stdin to prevent hanging on read
      detached: false,
      env: { 
        ...process.env, 
        PATH: `${process.env.HOME}/bin:${process.env.PATH}`,
        // Disable terminal title to prevent escape sequence leaks
        AGENT_CORE_DISABLE_TERMINAL_TITLE: "true",
        NO_COLOR: "true"
      }
    });

    // child.stdin?.end(); // Not needed if stdio is ignore

    worker.pid = child.pid;
    this.processes.set(worker.id, child);

    // Initialize output capture
    this.workerOutputs.set(worker.id, { stdout: "", stderr: "" });

    // Capture stdout (parse JSON stream)
    child.stdout?.on("data", (data) => {
      const output = this.workerOutputs.get(worker.id);
      if (output) {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "text" && event.part?.text) {
              output.stdout += event.part.text;
            } else if (event.type === "error" && event.error) {
              output.stderr += event.error + "\n";
            }
          } catch {
            // If not JSON, append as is (fallback)
            output.stdout += line + "\n";
          }
        }
        
        if (output.stdout.length > this.maxOutputChars) {
          output.stdout = output.stdout.slice(-this.maxOutputChars);
        }
      }
    });

    // Capture stderr
    child.stderr?.on("data", (data) => {
      const output = this.workerOutputs.get(worker.id);
      if (output) {
        output.stderr += data.toString();
        if (output.stderr.length > this.maxOutputChars) {
          output.stderr = output.stderr.slice(-this.maxOutputChars);
        }
      }
    });

    // Handle process completion
    child.on("exit", (code) => {
      this.handleWorkerComplete(worker.id, code === 0);
    });

    child.on("error", (err) => {
      this.handleWorkerError(worker.id, err.message);
    });
  }

  /**
   * Handle worker completion
   */
  private async handleWorkerComplete(workerId: WorkerId, success: boolean): Promise<void> {
    const worker = this.currentState.workers.find((w) => w.id === workerId);
    if (!worker) return;

    worker.status = success ? "idle" : "error";
    worker.lastActivityAt = Date.now();

    this.processes.delete(workerId);

    // Capture output
    const output = this.workerOutputs.get(workerId);
    const resultText = success ? output?.stdout || "Task completed" : undefined;
    const errorText = !success ? output?.stderr || output?.stdout || "Unknown error" : undefined;

    // Update any associated task
    const task = this.currentState.tasks.find((t) => t.workerId === workerId);
    if (task) {
      task.status = success ? "completed" : "failed";
      task.completedAt = Date.now();
      if (success) {
        task.result = resultText;
        this.currentState.stats.totalTasksCompleted++;
      } else {
        task.error = errorText;
      }
    }

    // Record neural pattern for training
    const topology = (worker.metadata?.topology as TopologyType) || "star";
    const durationMs = Date.now() - worker.createdAt;

    if (this.config.tiara.neuralTrainingEnabled && worker.currentTask) {
      this.neuralTrainer.recordExecution(
        worker.currentTask,
        worker.persona,
        topology,
        durationMs,
        success
      );

      // Execute onPatternLearned hook
      await this.hooksManager.execute({
        type: "onPatternLearned",
        timestamp: Date.now(),
        persona: worker.persona,
        workerId,
        task: worker.currentTask,
        topology,
        success,
        durationMs,
      });
    }

    // Execute onWorkerComplete hook
    await this.hooksManager.execute({
      type: "onWorkerComplete",
      timestamp: Date.now(),
      persona: worker.persona,
      workerId,
      task: worker.currentTask,
      topology,
      success,
      durationMs,
      error: errorText,
    });

    // Notify drone waiter
    if (success) {
      this.droneWaiter.notifyComplete(workerId, resultText);
    } else {
      this.droneWaiter.notifyError(workerId, errorText || "Task failed");
    }

    this.emitEvent(success ? "worker:completed" : "worker:error", { workerId });
    await this.saveState();
    await this.updateStatusPane();
  }

  /**
   * Handle worker error
   */
  private async handleWorkerError(workerId: WorkerId, error: string): Promise<void> {
    const worker = this.currentState.workers.find((w) => w.id === workerId);
    if (!worker) return;

    worker.status = "error";
    worker.lastActivityAt = Date.now();

    const task = this.currentState.tasks.find((t) => t.workerId === workerId);
    if (task) {
      task.status = "failed";
      task.error = error;
      task.completedAt = Date.now();
    }

    // Execute onError hook
    await this.hooksManager.execute({
      type: "onError",
      timestamp: Date.now(),
      persona: worker.persona,
      workerId,
      task: worker.currentTask,
      error,
    });

    this.emitEvent("worker:error", { workerId, error });
    await this.saveState();
  }

  /**
   * Kill a worker
   */
  async killWorker(workerId: WorkerId): Promise<void> {
    const worker = this.currentState.workers.find((w) => w.id === workerId);
    if (!worker) return;

    // Cancel any pending wait
    this.droneWaiter.notifyError(workerId, "Worker killed");

    // Kill process if running
    const process = this.processes.get(workerId);
    if (process) {
      process.kill();
      this.processes.delete(workerId);
    }

    // Close WezTerm pane
    if (worker.paneId) {
      await this.weztermBridge.closePane(worker.paneId);
    }

    worker.status = "terminated";
    worker.lastActivityAt = Date.now();

    this.emitEvent("worker:terminated", { workerId });
    await this.saveState();
    await this.updateStatusPane();
  }

  /**
   * Wait for a drone to complete
   */
  async waitForDrone(workerId: WorkerId, options?: WaitOptions): Promise<DroneResult> {
    return this.droneWaiter.waitFor(workerId, options);
  }

  /**
   * Spawn a drone and wait for completion
   */
  async spawnDroneWithWait(options: SpawnWithWaitOptions): Promise<DroneResult> {
    const { announce, cleanup, timeoutMs = TIMEOUT_DRONE_MS } = options;

    // Spawn the drone
    const worker = await this.spawnDrone({
      persona: options.persona,
      task: options.task,
      prompt: options.prompt,
    });

    // Wait for completion
    const result = await this.waitForDrone(worker.id, { timeoutMs });

    // Announce if requested
    if (announce && shouldAnnounce(result, announce)) {
      const announcement = formatAnnouncement(result, announce);
      log.info("Drone announcement", { announcement, workerId: worker.id, status: result.status });
    }

    // Cleanup if requested or fire-and-forget mode
    if (cleanup || timeoutMs === 0) {
      await this.killWorker(worker.id);
    }

    return result;
  }

  /**
   * Execute a task using SPARC methodology
   * SPARC: Specification → Pseudocode → Architecture → Refinement → Completion
   */
  async executeWithSPARC(options: SPARCWorkflowOptions): Promise<SPARCWorkflowResult> {
    const startTime = Date.now();
    const phases: SPARCPhaseResult[] = [];
    const allPhases: SPARCPhase[] = ["specification", "pseudocode", "architecture", "refinement", "completion"];
    const skipPhases = options.skipPhases || [];
    const phaseTimeoutMs = options.phaseTimeoutMs || 120000; // 2 min default per phase

    let previousOutput = options.prompt;

    // Execute beforeSPARC hook (can cancel)
    const shouldProceed = await this.hooksManager.execute({
      type: "beforeSPARC",
      timestamp: startTime,
      persona: options.persona,
      task: options.task,
      metadata: { skipPhases, phaseTimeoutMs },
    });

    if (!shouldProceed) {
      return {
        success: false,
        phases: [],
        error: "SPARC workflow cancelled by beforeSPARC hook",
        totalDurationMs: Date.now() - startTime,
      };
    }

    log.info("Starting SPARC workflow", {
      persona: options.persona,
      task: options.task.slice(0, 100),
      skipPhases,
    });

    for (const phase of allPhases) {
      if (skipPhases.includes(phase)) {
        log.debug("Skipping SPARC phase", { phase });
        continue;
      }

      const phaseStart = Date.now();

      try {
        // Build phase-specific prompt
        const phasePrompt = SPARC_PHASE_PROMPTS[phase](options.task, previousOutput);

        // Spawn drone for this phase
        const result = await this.spawnDroneWithWait({
          persona: options.persona,
          task: `[SPARC:${phase.toUpperCase()}] ${options.task}`,
          prompt: phasePrompt,
          timeoutMs: phaseTimeoutMs,
          cleanup: true,
        });

        const phaseResult: SPARCPhaseResult = {
          phase,
          output: result.result || "",
          durationMs: result.durationMs,
          workerId: undefined, // Worker is cleaned up
        };

        phases.push(phaseResult);

        if (result.status === "error" || result.status === "timeout") {
          log.warn("SPARC phase failed", { phase, error: result.error });
          return {
            success: false,
            phases,
            error: `Phase ${phase} failed: ${result.error}`,
            totalDurationMs: Date.now() - startTime,
          };
        }

        // Use this phase's output as context for next phase
        previousOutput = result.result || previousOutput;

        log.info("SPARC phase completed", {
          phase,
          durationMs: result.durationMs,
          outputLength: (result.result || "").length,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        phases.push({
          phase,
          output: "",
          durationMs: Date.now() - phaseStart,
        });

        return {
          success: false,
          phases,
          error: `Phase ${phase} threw error: ${errorMsg}`,
          totalDurationMs: Date.now() - startTime,
        };
      }
    }

    // Success - return the final completion phase output
    const completionPhase = phases.find(p => p.phase === "completion");
    const finalResult = completionPhase?.output || previousOutput;
    const totalDurationMs = Date.now() - startTime;

    log.info("SPARC workflow completed", {
      totalPhases: phases.length,
      totalDurationMs,
    });

    // Execute afterSPARC hook
    await this.hooksManager.execute({
      type: "afterSPARC",
      timestamp: Date.now(),
      persona: options.persona,
      task: options.task,
      success: true,
      durationMs: totalDurationMs,
      metadata: {
        phases: phases.map(p => ({ phase: p.phase, durationMs: p.durationMs })),
      },
    });

    return {
      success: true,
      phases,
      finalResult,
      totalDurationMs,
    };
  }

  /**
   * Smart task execution - uses SPARC for complex tasks, direct spawn for simple ones
   */
  async executeTask(options: {
    persona: PersonaId;
    task: string;
    prompt: string;
    forceSPARC?: boolean;
  }): Promise<DroneResult | SPARCWorkflowResult> {
    const useSPARC = options.forceSPARC || shouldUseSPARC(options.task, this.config);

    if (useSPARC) {
      return this.executeWithSPARC({
        persona: options.persona,
        task: options.task,
        prompt: options.prompt,
      });
    }

    // Direct execution for simple tasks
    return this.spawnDroneWithWait({
      persona: options.persona,
      task: options.task,
      prompt: options.prompt,
    });
  }

  /**
   * Submit a task for execution
   */
  async submitTask(
    taskInput: Omit<PersonasTask, "id" | "createdAt" | "status">
  ): Promise<PersonasTask> {
    const task: PersonasTask = {
      ...taskInput,
      id: generateTaskId(),
      status: "pending",
      createdAt: Date.now(),
    };

    this.currentState.tasks.push(task);
    this.emitEvent("task:created", { taskId: task.id });

    // Auto-spawn if enabled
    if (this.config.autoSpawn) {
      try {
        const worker = await this.spawnDrone({
          persona: task.persona,
          task: task.description,
          prompt: task.prompt,
          priority: task.priority,
          contextMemoryIds: task.contextMemoryIds,
        });
        task.workerId = worker.id;
        task.status = "assigned";
        this.emitEvent("task:assigned", { taskId: task.id, workerId: worker.id });
      } catch (e) {
        // Task stays pending if spawn fails
        log.warn("Auto-spawn failed, task remains pending", {
          taskId: task.id,
          persona: task.persona,
          error: String(e),
        });
      }
    }

    await this.saveState();
    return task;
  }

  /**
   * List workers with optional filter
   */
  listWorkers(filter?: { persona?: PersonaId; role?: WorkerRole }): Worker[] {
    let workers = this.currentState.workers;

    if (filter?.persona) {
      workers = workers.filter((w) => w.persona === filter.persona);
    }
    if (filter?.role) {
      workers = workers.filter((w) => w.role === filter.role);
    }

    return workers;
  }

  /**
   * List tasks with optional filter
   */
  listTasks(filter?: { persona?: PersonaId; status?: TaskStatus }): PersonasTask[] {
    let tasks = this.currentState.tasks;

    if (filter?.persona) {
      tasks = tasks.filter((t) => t.persona === filter.persona);
    }
    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }

    return tasks;
  }

  /**
   * Summarize conversation for continuity
   */
  async summarizeConversation(messages: string[]): Promise<string> {
    // For now, create a simple summary
    // In production, this would use an LLM to summarize
    const summary = messages.slice(-10).join("\n---\n");

    if (this.currentState.conversation) {
      this.currentState.conversation.summary = summary;
      this.currentState.conversation.updatedAt = Date.now();
    }

    await this.saveState();
    return summary;
  }

  /**
   * Restore context from a previous session
   */
  async restoreContext(sessionId: string): Promise<ConversationState | null> {
    const state = await this.memory.loadConversation(sessionId);
    if (state) {
      this.currentState.conversation = state;
      this.emitEvent("continuity:restored", { sessionId });
    }
    return state;
  }

  /**
   * Save current state to Qdrant
   */
  async saveState(): Promise<void> {
    this.currentState.lastSyncAt = Date.now();
    await this.memory.saveState(this.currentState);
    this.emitEvent("state:synced", {});
  }

  /**
   * Update WezTerm status pane
   */
  private async updateStatusPane(): Promise<void> {
    if (this.config.wezterm.enabled) {
      await this.weztermBridge.updateStatus(this.currentState);
    }
  }

  /**
   * Subscribe to events
   */
  subscribe(
    event: PersonasEventType | "*",
    handler: (event: PersonasEvent) => void
  ): () => void {
    const listener = (e: PersonasEvent) => handler(e);
    super.on(event === "*" ? "event" : event, listener);
    return () => super.off(event === "*" ? "event" : event, listener);
  }

  /**
   * Emit a typed event
   */
  private emitEvent(type: PersonasEventType, data: Record<string, unknown>): void {
    const event: PersonasEvent = {
      type,
      timestamp: Date.now(),
      persona: data.persona as PersonaId | undefined,
      workerId: data.workerId as WorkerId | undefined,
      taskId: data.taskId as string | undefined,
      data,
    };
    super.emit(type, event);
    super.emit("event", event);
  }

  /**
   * Shutdown tiara
   */
  async shutdown(): Promise<void> {
    // Clear sync interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Cancel all pending waits and shutdown drone waiter
    this.droneWaiter.cancelAll();
    shutdownDroneWaiter();

    // Kill all workers
    for (const worker of this.currentState.workers) {
      if (worker.status !== "terminated") {
        await this.killWorker(worker.id);
      }
    }

    // Save neural patterns before shutdown
    if (this.config.tiara.neuralTrainingEnabled) {
      await this.neuralTrainer.savePatterns(this.memory);
      log.info("Neural patterns saved", this.neuralTrainer.getStats());
    }

    // Final state save
    await this.saveState();

    // Close WezTerm panes
    await this.weztermBridge.closeAllPanes();
  }

  /**
   * Get neural training stats
   */
  getNeuralStats(): { totalPatterns: number; avgSamples: number; avgSuccessRate: number } {
    return this.neuralTrainer.getStats();
  }
}

/**
 * Create a personas layer tiara with default or custom configuration
 */
export function createOrchestrator(config?: Partial<PersonasConfig>): Orchestrator {
  return new Orchestrator(config);
}

/**
 * Singleton instance for global access
 */
let globalOrchestrator: Orchestrator | null = null;

/**
 * Get or create the global tiara instance
 */
export async function getOrchestrator(
  config?: Partial<PersonasConfig>
): Promise<Orchestrator> {
  if (!globalOrchestrator) {
    globalOrchestrator = createOrchestrator(config);
    await globalOrchestrator.init();
  }
  return globalOrchestrator;
}

/**
 * Shutdown the global tiara
 */
export async function shutdownOrchestrator(): Promise<void> {
  if (globalOrchestrator) {
    await globalOrchestrator.shutdown();
    globalOrchestrator = null;
  }
}
