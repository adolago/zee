/**
 * Personas Module
 *
 * Unified orchestration system for personas: Zee, Stanley, Johny.
 * Provides shared capabilities for all personas:
 * - Drone spawning for background tasks
 * - Qdrant-backed memory and state persistence
 * - WezTerm pane management for visualization
 * - Conversation continuity across compacting
 */

// Types
export * from "./types";

// Persona utilities
export {
  generateDronePrompt,
  getPersonaConfig,
  generateWorkerName,
} from "./persona";

// Unified Memory System (replaces memory-bridge.ts and continuity.ts)
export {
  Memory,
  getMemory,
  resetMemory,
  extractKeyFacts,
  generateSummary,
  mergeFacts,
  createConversationState,
  updateConversationState,
  formatContextForPrompt,
  type ConversationState,
  type PersonaId,
  type PersonasState,
  type MemoryConfig,
} from "../memory/unified";

// WezTerm integration
export {
  WeztermPaneBridge,
  createWeztermBridge,
} from "./wezterm";

// Drone wait & announce
export {
  DroneWaiter,
  getDroneWaiter,
  shutdownDroneWaiter,
  formatAnnouncement,
  shouldAnnounce,
  buildSpawnConfig,
} from "./drone-wait";
