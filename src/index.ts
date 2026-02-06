/**
 * Agent Core - Unified AI Agent Foundation
 *
 * Powers Stanley (GUI/GPUI), Zee (WhatsApp/Matrix), and agent-core (CLI/TUI)
 * with subscription-based auth support (Claude Max, ChatGPT Plus, GitHub Copilot).
 *
 * ## Architecture Overview
 *
 * - **Provider System**: 15+ LLM providers with models.dev integration
 * - **Agent System**: Configurable personas, permissions, and mode switching
 * - **Tool System**: Built-in tools with MCP integration
 * - **Memory Layer**: Qdrant vector storage with semantic search
 * - **Surface Abstraction**: CLI/TUI, GUI, and Messaging adapters
 * - **Plugin System**: Hook-based extensibility
 * - **Session Management**: Streaming, retry logic, persistence
 *
 * @packageDocumentation
 */

// Core modules - use subpath exports for detailed access
// e.g., import { ... } from "@agent-core/core/provider"
// e.g., import { ... } from "@agent-core/core/mcp"

// Provider System - Multi-LLM support with subscription auth
export * as Provider from "./provider/types.js";

// Agent System - Configurable personas and permissions
export * as Agent from "./agent/types.js";

// Tool System - Built-in tools and MCP integration
export * as Tool from "./tool/types.js";

// MCP - Model Context Protocol servers
export * as Mcp from "./mcp/types.js";

// Memory - Qdrant-backed semantic memory
export * as Memory from "./memory/types.js";

// Surface - Abstraction for CLI/GUI/Messaging UIs
export * as Surface from "./surface/types.js";

// Session - Conversation state management
export * as Session from "./session/types.js";

// Plugin - Hook-based extensibility
export * as Plugin from "./plugin/types.js";

// Configuration - Constants and types
export * as Config from "./config/index.js";

// Transport - Communication abstractions
export * as Transport from "./transport/types.js";

// Utilities - Common helpers and types
export * as Util from "./util/types.js";

// Re-export common utilities
export { z } from "zod";
export type { LanguageModel } from "ai";
export type LanguageModelV1 = import("ai").LanguageModel;

/** agent-core version */
export const VERSION = "0.1.0";

/** Package metadata */
export const PACKAGE = {
  name: "@agent-core/core",
  version: VERSION,
  description: "Unified foundation for AI agent applications",
} as const;
