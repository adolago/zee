/**
 * Agent Module - Public API
 *
 * This module exports the agent persona system for zee.
 * It supports three use cases:
 * - Stanley: Professional financial analysis
 * - Zee: Personal AI assistant
 * - Legacy: Development agent (inherited patterns)
 */

// Core agent types and utilities
export * from "./agent.js";

// Persona system
export * from "./persona.js";

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

// Re-export built-in persona definitions
export * as Personas from "./personas.js";
