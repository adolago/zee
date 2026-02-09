/**
 * Surface Interface
 *
 * The core abstraction that all surface adapters must implement.
 * Surfaces are the bridge between different UIs and the agent core.
 */

import type {
  PermissionRequest,
  PermissionResponse,
  StreamChunk,
  SurfaceCapabilities,
  SurfaceEvent,
  SurfaceMessage,
  SurfaceResponse,
  SurfaceState,
  ToolCall,
  ToolResult,
} from './types.js';
import { Log } from '../util/log';

const log = Log.create({ service: 'surface' });

// =============================================================================
// Core Surface Interface
// =============================================================================

/**
 * Surface adapter interface.
 *
 * Each surface implementation (CLI, GUI, messaging) must implement this
 * interface to connect to the agent core.
 *
 * @example
 * ```typescript
 * class CLISurface implements Surface {
 *   readonly id = 'cli';
 *   readonly name = 'Command Line Interface';
 *   // ... implementation
 * }
 * ```
 */
export interface Surface {
  /** Unique surface identifier */
  readonly id: string;

  /** Human-readable surface name */
  readonly name: string;

  /** Surface capabilities */
  readonly capabilities: SurfaceCapabilities;

  /** Current connection state */
  readonly state: SurfaceState;

  // ---------------------------------------------------------------------------
  // Lifecycle Methods
  // ---------------------------------------------------------------------------

  /**
   * Initialize and connect the surface.
   * Called once when the surface is first activated.
   */
  connect(): Promise<void>;

  /**
   * Gracefully disconnect the surface.
   * Should clean up resources and pending operations.
   */
  disconnect(): Promise<void>;

  // ---------------------------------------------------------------------------
  // Message Handling
  // ---------------------------------------------------------------------------

  /**
   * Send a response to the surface.
   *
   * For non-streaming surfaces, this sends a complete message.
   * For streaming surfaces, this may be called multiple times with partial=true.
   *
   * @param response - The response to send
   * @param threadId - Optional thread/conversation to send to
   */
  sendResponse(response: SurfaceResponse, threadId?: string): Promise<void>;

  /**
   * Send a streaming chunk to the surface.
   *
   * Only called if capabilities.streaming is true.
   * Non-streaming surfaces should buffer chunks and send on isFinal=true.
   *
   * @param chunk - The streaming chunk
   * @param threadId - Optional thread/conversation
   */
  sendStreamChunk(chunk: StreamChunk, threadId?: string): Promise<void>;

  /**
   * Send a typing indicator to the surface.
   *
   * Only called if capabilities.typingIndicators is true.
   *
   * @param threadId - Optional thread/conversation
   */
  sendTypingIndicator(threadId?: string): Promise<void>;

  // ---------------------------------------------------------------------------
  // Tool & Permission Handling
  // ---------------------------------------------------------------------------

  /**
   * Request permission from the user.
   *
   * For surfaces with interactivePrompts=true, this shows a prompt.
   * For surfaces without, this applies the default action from config.
   *
   * @param request - The permission request
   * @returns The user's response or automatic response based on config
   */
  requestPermission(request: PermissionRequest): Promise<PermissionResponse>;

  /**
   * Notify the surface that a tool is being executed.
   *
   * Allows surfaces to show progress or status for long-running tools.
   *
   * @param toolCall - The tool being executed
   */
  notifyToolStart(toolCall: ToolCall): Promise<void>;

  /**
   * Notify the surface that a tool has completed.
   *
   * @param result - The tool execution result
   */
  notifyToolEnd(result: ToolResult): Promise<void>;

  // ---------------------------------------------------------------------------
  // Event Handling
  // ---------------------------------------------------------------------------

  /**
   * Register a handler for surface events.
   *
   * The agent core uses this to receive messages and other events.
   *
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  onEvent(handler: (event: SurfaceEvent) => void): () => void;
}

// =============================================================================
// Surface Context
// =============================================================================

/**
 * Context passed to the agent for each message.
 *
 * Contains surface-specific information that may affect agent behavior.
 */
export type SurfaceContext = {
  /** Surface identifier */
  surfaceId: string;
  /** Surface name for display */
  surfaceName: string;
  /** Surface capabilities */
  capabilities: SurfaceCapabilities;
  /** Sender identifier */
  senderId: string;
  /** Sender display name */
  senderName?: string;
  /** Thread/conversation ID */
  threadId?: string;
  /** Whether this is a group conversation */
  isGroup: boolean;
  /** Group name if applicable */
  groupName?: string;
  /** Whether the agent was mentioned */
  wasMentioned?: boolean;
  /** Message timestamp */
  timestamp: number;
  /** Original message ID for threading */
  messageId: string;
};

/**
 * Build surface context from a message.
 */
export function buildSurfaceContext(
  surface: Surface,
  message: SurfaceMessage
): SurfaceContext {
  return {
    surfaceId: surface.id,
    surfaceName: surface.name,
    capabilities: surface.capabilities,
    senderId: message.senderId,
    senderName: message.senderName,
    threadId: message.thread?.threadId,
    isGroup: message.thread?.isGroup ?? false,
    groupName: message.thread?.groupName,
    wasMentioned: message.thread?.wasMentioned,
    timestamp: message.timestamp,
    messageId: message.id,
  };
}

// =============================================================================
// Surface Registry
// =============================================================================

/**
 * Registry of available surfaces.
 */
export class SurfaceRegistry {
  private surfaces = new Map<string, Surface>();

  /**
   * Register a surface adapter.
   */
  register(surface: Surface): void {
    if (this.surfaces.has(surface.id)) {
      throw new Error(`Surface with id '${surface.id}' is already registered`);
    }
    this.surfaces.set(surface.id, surface);
  }

  /**
   * Unregister a surface adapter.
   */
  unregister(surfaceId: string): boolean {
    return this.surfaces.delete(surfaceId);
  }

  /**
   * Get a surface by ID.
   */
  get(surfaceId: string): Surface | undefined {
    return this.surfaces.get(surfaceId);
  }

  /**
   * Get all registered surfaces.
   */
  getAll(): Surface[] {
    return Array.from(this.surfaces.values());
  }

  /**
   * Check if a surface is registered.
   */
  has(surfaceId: string): boolean {
    return this.surfaces.has(surfaceId);
  }
}

// =============================================================================
// Base Surface Implementation
// =============================================================================

/**
 * Abstract base class for surface implementations.
 *
 * Provides common functionality and sensible defaults.
 */
export abstract class BaseSurface implements Surface {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly capabilities: SurfaceCapabilities;

  protected _state: SurfaceState = 'disconnected';
  protected eventHandlers = new Set<(event: SurfaceEvent) => void>();

  get state(): SurfaceState {
    return this._state;
  }

  protected setState(state: SurfaceState, error?: Error): void {
    this._state = state;
    this.emit({ type: 'state_change', state, error });
  }

  protected emit(event: SurfaceEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        log.error('Surface event handler error', {
          eventType: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  onEvent(handler: (event: SurfaceEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  // Default implementations that can be overridden

  async sendStreamChunk(chunk: StreamChunk, threadId?: string): Promise<void> {
    // Default: buffer and send on final
    if (chunk.isFinal && chunk.text) {
      await this.sendResponse({ text: chunk.text }, threadId);
    }
  }

  async sendTypingIndicator(_threadId?: string): Promise<void> {
    // Default: no-op for surfaces that don't support typing
  }

  async notifyToolStart(_toolCall: ToolCall): Promise<void> {
    // Default: no-op
  }

  async notifyToolEnd(_result: ToolResult): Promise<void> {
    // Default: no-op
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract sendResponse(response: SurfaceResponse, threadId?: string): Promise<void>;
  abstract requestPermission(request: PermissionRequest): Promise<PermissionResponse>;
}
