/**
 * Personas Types
 *
 * Type definitions for personas layer - a wrapper around tiara's
 * hive-mind that provides persona-specific orchestration for Zee, Stanley, and Johny.
 *
 * Each persona can act as a Queen (primary conversation) and spawn Drones
 * (background workers) that maintain persona's identity and capabilities.
 */

import { z } from "zod";
import { personaPalettes } from "../theme/rosetta";

// =============================================================================
// Persona Types
// =============================================================================

/** The three personas in personas layer */
export const PersonaId = z.enum(["zee", "stanley", "johny"]);
export type PersonaId = z.infer<typeof PersonaId>;

/**
 * Orchestration persona info for the Personas layer
 * (distinct from agent/persona.ts:PersonaConfig which handles file loading)
 */
export interface OrchestrationPersona {
  /** Persona identifier */
  id: PersonaId;
  /** Display name */
  displayName: string;
  /** Short description */
  description: string;
  /** Domain of expertise */
  domain: string;
  /** Default capabilities when spawning drones */
  defaultCapabilities: string[];
  /** System prompt additions for this persona */
  systemPromptAdditions: string[];
  /** Color for UI (hex) */
  color: string;
  /** Icon/emoji */
  icon: string;
}

/** Built-in persona configurations for orchestration */
export const ORCHESTRATION_PERSONAS: Record<PersonaId, OrchestrationPersona> = {
  zee: {
    id: "zee",
    displayName: "Zee",
    description: "Personal assistant with memory and messaging",
    domain: "personal",
    defaultCapabilities: [
      "task_management",
      "information_gathering",
      "knowledge_synthesis",
      "documentation_generation",
      "browser_automation", // Zee-exclusive: handles all browser tasks for all personas
    ],
    systemPromptAdditions: [
      "You are Zee, a personal assistant.",
      "You help with daily tasks, research, and communication.",
      "You maintain context across conversations.",
      "You are the sole browser operator for all personas. Stanley and Johny delegate browser tasks to you.",
    ],
    color: personaPalettes.zee.primary.hex, // Sapphire Shadow - Blue (Zee)
    icon: "★",
  },
  stanley: {
    id: "stanley",
    displayName: "Stanley",
    description: "Investment platform inspired by Druckenmiller",
    domain: "finance",
    defaultCapabilities: [
      "data_analysis",
      "performance_metrics",
      "pattern_recognition",
      "bottleneck_detection",
      // NOTE: No browser_automation - delegate to @zee
    ],
    systemPromptAdditions: [
      "You are Stanley, an investment analysis assistant.",
      "You help with market analysis, portfolio management, and trading decisions.",
      "You think in terms of risk/reward and macro trends.",
      "For browser automation tasks, delegate to @zee who handles all web interactions.",
    ],
    color: personaPalettes.stanley.primary.hex, // Emerald Phantom - Green (Stanley)
    icon: "♦",
  },
  johny: {
    id: "johny",
    displayName: "Johny",
    description: "Learning system inspired by von Neumann",
    domain: "learning",
    defaultCapabilities: [
      "knowledge_synthesis",
      "pattern_recognition",
      "technical_writing",
      "problem_solving",
      // NOTE: No browser_automation - delegate to @zee
    ],
    systemPromptAdditions: [
      "You are Johny, a learning and study assistant.",
      "You help with understanding complex topics, spaced repetition, and knowledge retention.",
      "You think systematically and build knowledge graphs.",
      "For browser automation tasks, delegate to @zee who handles all web interactions.",
    ],
    color: personaPalettes.johny.primary.hex, // Crimson Specter - Red (Johny)
    icon: "◎",
  },
};

// =============================================================================
// Worker Types
// =============================================================================

/** Worker role - Queen (primary) or Drone (background) */
export const WorkerRole = z.enum(["queen", "drone"]);
export type WorkerRole = z.infer<typeof WorkerRole>;

/** Worker status */
export const WorkerStatus = z.enum([
  "spawning",
  "idle",
  "working",
  "reporting",
  "terminated",
  "error",
]);
export type WorkerStatus = z.infer<typeof WorkerStatus>;

/** Worker identifier */
export const WorkerId = z.string().brand<"WorkerId">();
export type WorkerId = z.infer<typeof WorkerId>;

/** A worker instance */
export const Worker = z.object({
  id: WorkerId,
  persona: PersonaId,
  role: WorkerRole,
  status: WorkerStatus,
  /** WezTerm pane ID */
  paneId: z.string().optional(),
  /** Process ID */
  pid: z.number().optional(),
  /** Current task description */
  currentTask: z.string().optional(),
  /** Tiara agent ID */
  tiaraAgentId: z.string().optional(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
  /** Worker metadata (e.g., topology, SPARC phase) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Worker = z.infer<typeof Worker>;

// =============================================================================
// Task Types
// =============================================================================

/** Task priority */
export const TaskPriority = z.enum(["low", "normal", "high", "critical"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

/** Task status */
export const TaskStatus = z.enum([
  "pending",
  "assigned",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** A task to be executed by a drone */
export const PersonasTask = z.object({
  id: z.string(),
  /** Which persona should handle this */
  persona: PersonaId,
  /** Task description */
  description: z.string(),
  /** Full prompt for the drone */
  prompt: z.string(),
  priority: TaskPriority,
  status: TaskStatus,
  /** Assigned worker ID */
  workerId: WorkerId.optional(),
  /** Memory context IDs to inject */
  contextMemoryIds: z.array(z.string()).default([]),
  /** Result when completed */
  result: z.string().optional(),
  /** Error if failed */
  error: z.string().optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
});
export type PersonasTask = z.infer<typeof PersonasTask>;

// =============================================================================
// Drone Wait & Announce
// =============================================================================

export interface DroneResult {
  workerId: WorkerId;
  status: "ok" | "timeout" | "error";
  result?: string;
  error?: string;
  durationMs: number;
}

export interface WaitOptions {
  /** Timeout in milliseconds (0 = fire-and-forget) */
  timeoutMs?: number;
  /** Poll interval for checking completion */
  pollIntervalMs?: number;
}

export interface AnnounceTarget {
  /** Target type (surface, channel, etc.) */
  type: "surface" | "channel" | "webhook";
  /** Target identifier */
  id: string;
  /** Optional format preference */
  format?: "text" | "markdown" | "json";
}

export interface AnnounceOptions {
  /** Where to announce the result */
  target: AnnounceTarget;
  /** Whether to skip if result is trivial */
  skipTrivial?: boolean;
  /** Custom message prefix */
  prefix?: string;
  /** Whether to clean up drone after announcing */
  cleanup?: boolean;
}

export interface SpawnWithWaitOptions {
  /** Persona to spawn */
  persona: PersonaId;
  /** Task description */
  task: string;
  /** Full prompt */
  prompt: string;
  /** Label for tracking */
  label?: string;
  /** Timeout (0 = fire-and-forget) */
  timeoutMs?: number;
  /** Announce options */
  announce?: AnnounceOptions;
  /** Whether to clean up drone after completion */
  cleanup?: boolean;
}

// =============================================================================
// Conversation Continuity
// =============================================================================

/** Conversation state that persists across compacting */
export const ConversationState = z.object({
  /** Current session ID */
  sessionId: z.string(),
  /** Persona leading the conversation */
  leadPersona: PersonaId,
  /** Summary of conversation so far */
  summary: z.string(),
  /** Key facts extracted */
  keyFacts: z.array(z.string()),
  /** Current plan/objectives */
  plan: z.string(),
  /** Active goals */
  objectives: z.array(z.string()),
  /** Session chain (previous session IDs) */
  sessionChain: z.array(z.string()),
  /** Last updated */
  updatedAt: z.number(),
});
export type ConversationState = z.infer<typeof ConversationState>;

// =============================================================================
// Personas State
// =============================================================================

/** The full state of personas layer */
export const PersonasState = z.object({
  /** Version for migrations */
  version: z.string().default("1.0.0"),
  /** Tiara swarm ID */
  tiaraSwarmId: z.string().optional(),
  /** Active workers by persona */
  workers: z.array(Worker),
  /** Pending and active tasks */
  tasks: z.array(PersonasTask),
  /** Conversation continuity state */
  conversation: ConversationState.optional(),
  /** Last sync to Qdrant */
  lastSyncAt: z.number(),
  /** Stats */
  stats: z.object({
    totalTasksCompleted: z.number().default(0),
    totalDronesSpawned: z.number().default(0),
    totalTokensUsed: z.number().default(0),
  }),
});
export type PersonasState = z.infer<typeof PersonasState>;

// =============================================================================
// Configuration
// =============================================================================

/** Personas layer configuration */
export const PersonasConfig = z.object({
  /** Max drones per persona */
  maxDronesPerPersona: z.number().int().positive().default(3),
  /** Auto-spawn drones for heavy tasks */
  autoSpawn: z.boolean().default(true),
  /** WezTerm settings */
  wezterm: z.object({
    enabled: z.boolean().default(true),
    layout: z.enum(["horizontal", "vertical", "grid"]).default("horizontal"),
    showStatusPane: z.boolean().default(true),
  }).default({}),
  /** Qdrant settings for memory */
  qdrant: z.object({
    url: z.string().default("http://localhost:6333"),
    stateCollection: z.string().default("personas_state"),
    memoryCollection: z.string().default("personas_memory"),
    apiKey: z.string().optional(),
  }).default({}),
  /** Conversation continuity settings */
  continuity: z.object({
    /** Auto-summarize on compaction */
    autoSummarize: z.boolean().default(true),
    /** Token threshold to trigger summary */
    summaryThreshold: z.number().int().positive().default(60000),
    /** Max key facts to retain */
    maxKeyFacts: z.number().int().positive().default(50),
  }).default({}),
  /** Tiara integration */
  tiara: z.object({
    /** Use tiara for orchestration */
    enabled: z.boolean().default(true),
    /** Topology for swarm - 'auto' enables dynamic selection based on task type */
    topology: z.enum(["mesh", "hierarchical", "star", "adaptive", "auto"]).default("auto"),
    /** Enable SPARC methodology for complex planning tasks */
    sparcEnabled: z.boolean().default(false),
    /** Enable neural pattern training for optimization */
    neuralTrainingEnabled: z.boolean().default(false),
  }).default({}),
});
export type PersonasConfig = z.infer<typeof PersonasConfig>;

// =============================================================================
// Events
// =============================================================================

/** Event types */
export const PersonasEventType = z.enum([
  // Worker events
  "worker:spawned",
  "worker:ready",
  "worker:working",
  "worker:completed",
  "worker:terminated",
  "worker:error",
  // Task events
  "task:created",
  "task:assigned",
  "task:started",
  "task:completed",
  "task:failed",
  // Continuity events
  "continuity:summarized",
  "continuity:restored",
  // State events
  "state:synced",
]);
export type PersonasEventType = z.infer<typeof PersonasEventType>;

/** A personas layer event */
export const PersonasEvent = z.object({
  type: PersonasEventType,
  timestamp: z.number(),
  persona: PersonaId.optional(),
  workerId: WorkerId.optional(),
  taskId: z.string().optional(),
  data: z.unknown(),
});
export type PersonasEvent = z.infer<typeof PersonasEvent>;

// =============================================================================
// Service Interfaces
// =============================================================================

// =============================================================================
// Service Interfaces
// =============================================================================

/** Main personas layer tiara interface */
export interface PersonasOrchestrator {
  /** Initialize the personas system */
  init(): Promise<void>;

  /** Get current state */
  state(): PersonasState;

  /** Get conversation continuity state */
  conversation(): ConversationState | undefined;

  /** Update the current plan */
  setPlan(plan: string): Promise<void>;

  /** Add an objective */
  addObjective(objective: string): Promise<void>;

  /** Spawn a drone for a task */
  spawnDrone(options: {
    persona: PersonaId;
    task: string;
    prompt: string;
    priority?: TaskPriority;
    contextMemoryIds?: string[];
  }): Promise<Worker>;

  /** Wait for a drone to complete */
  waitForDrone(workerId: WorkerId, options?: WaitOptions): Promise<DroneResult>;

  /** Spawn a drone and wait for completion */
  spawnDroneWithWait(options: SpawnWithWaitOptions): Promise<DroneResult>;

  /** Kill a worker */
  killWorker(workerId: WorkerId): Promise<void>;

  /** Submit a task (auto-assigns to appropriate drone) */
  submitTask(task: Omit<PersonasTask, "id" | "createdAt" | "status">): Promise<PersonasTask>;

  /** List workers */
  listWorkers(filter?: { persona?: PersonaId; role?: WorkerRole }): Worker[];

  /** List tasks */
  listTasks(filter?: { persona?: PersonaId; status?: TaskStatus }): PersonasTask[];

  /** Summarize conversation for continuity */
  summarizeConversation(messages: string[]): Promise<string>;

  /** Restore context from previous session */
  restoreContext(sessionId: string): Promise<ConversationState | null>;

  /** Save current state */
  saveState(): Promise<void>;

  /** Subscribe to events */
  subscribe(event: PersonasEventType | "*", handler: (event: PersonasEvent) => void): () => void;

  /** Shutdown */
  shutdown(): Promise<void>;
}

/** WezTerm bridge interface */
export interface WeztermBridge {
  /** Check if WezTerm CLI is available */
  isAvailable(): Promise<boolean>;

  /** Create a pane for a worker */
  createWorkerPane(worker: Worker): Promise<string>;

  /** Close a pane */
  closePane(paneId: string): Promise<void>;

  /** Send command to pane */
  sendCommand(paneId: string, command: string): Promise<void>;

  /** Get pane output */
  getOutput(paneId: string): Promise<string>;

  /** Set up personas layer layout */
  setupLayout(config: PersonasConfig["wezterm"]): Promise<void>;

  /** Update status pane */
  updateStatus(state: PersonasState): Promise<void>;
}

/** Memory bridge interface */
export interface MemoryBridge {
  /** Save state to Qdrant */
  saveState(state: PersonasState): Promise<void>;

  /** Load state from Qdrant */
  loadState(): Promise<PersonasState | null>;

  /** Store a memory for continuity (requires persona in metadata for isolation) */
  storeMemory(content: string, metadata: Record<string, unknown>): Promise<string>;

  /** Search memories by query (persona-isolated unless searching shared namespace) */
  searchMemories(
    query: string,
    limit?: number,
    options?: { persona?: string; includeShared?: boolean }
  ): Promise<Array<{ id: string; content: string; score: number }>>;

  /** Search memories across all personas (for cross-persona context) */
  searchAllPersonaMemories?(
    query: string,
    limit?: number
  ): Promise<Array<{ id: string; content: string; score: number; persona?: string }>>;

  /** Get memories by IDs */
  getMemories(ids: string[]): Promise<Array<{ id: string; content: string }>>;

  /** Store key facts (requires persona for isolation) */
  storeKeyFacts?(facts: string[], sessionId: string, persona: string): Promise<void>;
}