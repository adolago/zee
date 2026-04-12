/**
 * Configuration Module
 *
 * Exports shared configuration types and constants for zee.
 *
 * The main config system lives in packages/zee/src/config/config.ts
 * This module provides:
 * - Shared constants (ports, URLs, timeouts)
 * - Shared types (DmPolicy, GroupPolicy, etc.)
 * - Zee-specific types (AssistantConfig, SurfaceConfigs)
 */

// Shared constants (local memory, timeouts, ports, etc.)
export * from "./constants";

// Shared types (DmPolicy, GroupPolicy, LogLevel, RetryConfig)
export * from "./shared";

// Zee-specific types (ZeeRootConfig, AssistantConfig, etc.)
export * from "./types";
