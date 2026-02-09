/**
 * Configuration Module
 *
 * Exports shared configuration types and constants for zee.
 *
 * The main config system lives in packages/zee-core/src/config/config.ts
 * This module provides:
 * - Shared constants (ports, URLs, timeouts)
 * - Shared types (DmPolicy, GroupPolicy, etc.)
 * - Zee-specific types (AgentPersonaConfig, SurfaceConfigs)
 */

// Shared constants (Qdrant URLs, timeouts, ports, etc.)
export * from "./constants";

// Shared types (DmPolicy, GroupPolicy, LogLevel, RetryConfig)
export * from "./shared";

// Zee-specific types (AgentCoreConfig, AgentPersonaConfig, etc.)
export * from "./types";
