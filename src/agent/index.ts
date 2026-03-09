/**
 * Agent Module - Public API
 *
 * This module exports Zee's agent profile system.
 * It supports three use cases:
 * - Investing: Financial analysis capability pack
 * - Zee: Personal AI assistant
 * - Legacy: Development agent (inherited patterns)
 */

// Core agent types and utilities
export * from "./agent.js";

// Assistant profile system
export * from "./profile.js";

// Permission evaluation
export * from "./permission.js";

// Capability-based routing
export * from "./capability.js";

// Agent handoff protocol
export * from "./handoff.js";

// Filesystem skill discovery
export * from "./skill-discovery.js";

// Skill tool interface
export * from "./skill-tool.js";

// Re-export built-in assistant definitions
export * as Assistants from "./assistants.js";
