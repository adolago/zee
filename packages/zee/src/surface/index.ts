/**
 * Surface Abstraction Layer
 *
 * The surface module provides a unified interface for connecting different UIs
 * (CLI and messaging platforms) to the Zee engine. Each surface adapter
 * translates between the surface-specific protocols and the agent's message format.
 *
 * Architecture:
 * ```
 *                    +-----------------+
 *                    |   Zee Engine    |
 *                    +--------+--------+
 *                             |
 *                    +--------v--------+
 *                    | Surface Router  |
 *                    +--------+--------+
 *                             |
 *        +--------------------+--------------------+
 *        |                    |                    |
 * +------v------+      +------v------+
 * | CLI Surface |      | Msg Surface |
 * +-------------+      +-------------+
 *        |                    |
 *    Terminal           Platform APIs
 *                        (WA)
 * ```
 *
 * Key Concepts:
 *
 * 1. **Surface Interface**: All surfaces implement the same interface for
 *    sending/receiving messages, handling permissions, and managing state.
 *
 * 2. **Capabilities**: Each surface declares what it supports (streaming,
 *    interactive prompts, media, etc.) so the agent can adapt its behavior.
 *
 * 3. **Permission Model**: Surfaces handle permission requests differently:
 *    - CLI: Interactive prompts with keyboard input
 *    - Messaging: Automatic resolution based on config (no interactive prompts)
 *
 * 4. **Streaming vs Batching**: Some surfaces (CLI) support streaming
 *    responses while others (messaging) require complete messages.
 *
 * @module surface
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Message types
  SurfaceMessage,
  SurfaceMedia,
  ThreadContext,

  // Response types
  SurfaceResponse,
  ResponseMetadata,

  // Tool types
  ToolCall,
  ToolResult,

  // Permission types
  PermissionRequest,
  PermissionType,
  PermissionAction,
  PermissionResponse,

  // Stream types
  StreamChunk,

  // Lifecycle types
  SurfaceState,
  SurfaceEvent,

  // Capability types
  SurfaceCapabilities,

  // Extended types
  SurfaceType,
  MessageContext,
  SurfaceAdapter,
} from "./types.js"

export {
  DEFAULT_CAPABILITIES,
  CLI_CAPABILITIES,
  WEB_CAPABILITIES,
  WHATSAPP_CAPABILITIES,
  TELEGRAM_CAPABILITIES,
  API_CAPABILITIES,
  formatForSurface,
} from "./types.js"

// =============================================================================
// Surface Interface
// =============================================================================

export type { Surface, SurfaceContext } from "./surface.js"

export { BaseSurface, SurfaceRegistry, buildSurfaceContext } from "./surface.js"

// =============================================================================
// Configuration
// =============================================================================

export type {
  PermissionPolicy,
  PermissionConfig,
  CLISurfaceConfig,
  MessagingSurfaceConfig,
  SurfaceConfig,
  UXAdaptations,
} from "./config.js"

export {
  DEFAULT_PERMISSION_CONFIG,
  DEFAULT_CLI_CONFIG,
  DEFAULT_MESSAGING_CONFIG,
  DEFAULT_UX_ADAPTATIONS,
  mergePermissionConfig,
  resolveCLISurfaceConfig,
  resolveMessagingSurfaceConfig,
  buildSurfaceConfig,
  resolvePermission,
} from "./config.js"

// =============================================================================
// Surface Implementations
// =============================================================================

// CLI Surface
export { CLISurface, createCLISurface } from "./cli.js"

// Messaging Surfaces
export type { MessagingPlatformHandler, PlatformMessage } from "./messaging.js"

export { MessagingSurface, createMessagingSurface } from "./messaging.js"

// Platform Handlers
export * from "./platforms/index.js"

// =============================================================================
// Router
// =============================================================================

export type { MessageHandler, SurfaceAnalyticsEvent, SurfaceRouterConfig } from "./router.js"

export { SurfaceRouter, getSurfaceRouter, setSurfaceRouter, resetSurfaceRouter } from "./router.js"

// =============================================================================
// Convenience Functions
// =============================================================================

import { createCLISurface } from "./cli.js"
import type { Surface } from "./surface.js"
import type { SurfaceCapabilities } from "./types.js"
import {
  CLI_CAPABILITIES,
  WHATSAPP_CAPABILITIES,
  TELEGRAM_CAPABILITIES,
  API_CAPABILITIES,
  DEFAULT_CAPABILITIES,
} from "./types.js"

/**
 * Create a surface instance based on type.
 *
 * For messaging platforms (whatsapp), use createMessagingSurface()
 * with your own platform handler implementation instead.
 */
export function createSurface(type: "cli", config?: Record<string, unknown>): Surface {
  switch (type) {
    case "cli":
      return createCLISurface(config)
    default:
      throw new Error(
        `Unknown surface type: ${type}. For messaging platforms, use createMessagingSurface() with your handler.`,
      )
  }
}

/**
 * Get default capabilities for a surface type.
 */
export function getDefaultCapabilities(type: "cli" | "whatsapp" | "telegram" | "api"): SurfaceCapabilities {
  switch (type) {
    case "cli":
      return CLI_CAPABILITIES
    case "whatsapp":
      return WHATSAPP_CAPABILITIES
    case "telegram":
      return TELEGRAM_CAPABILITIES
    case "api":
      return API_CAPABILITIES
    default:
      return DEFAULT_CAPABILITIES
  }
}
