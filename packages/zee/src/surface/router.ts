/**
 * Surface Router
 *
 * Central routing layer that connects surfaces (CLI, GUI, messaging) to the agent core.
 * Handles message routing, session management, and surface lifecycle.
 *
 * Architecture:
 * ```
 * +----------------+     +------------------+     +------------------+
 * |  CLI Surface   |---->|                  |---->|   Agent Core     |
 * +----------------+     |   Surface Router |     |   (MCP/Session)  |
 * +----------------+---->|                  |<----|                  |
 * |  GUI Surface   |     +------------------+     +------------------+
 * +----------------+---->|         |          ^
 * +----------------+---->|         v          |
 * |  Messaging     |     |   Analytics/      |
 * |  Surface       |     |   Hot Reload      |
 * +----------------+     +------------------+
 * ```
 */

import type { Surface, SurfaceContext } from './surface.js';
import type {
  SurfaceMessage,
  SurfaceResponse,
  StreamChunk,
  SurfaceEvent,
  SurfaceCapabilities,
  PermissionRequest,
  PermissionResponse,
} from './types.js';
import { SurfaceRegistry } from './surface.js';
import { Log } from '../util/log';
import { EventEmitter } from '../bus/event-emitter';

const log = Log.create({ service: 'surface-router' });

// =============================================================================
// Types
// =============================================================================

/** Message handler function type */
export type MessageHandler = (
  message: SurfaceMessage,
  context: SurfaceContext
) => Promise<SurfaceResponse | AsyncIterable<StreamChunk>>;

/** Surface analytics event */
export type SurfaceAnalyticsEvent = {
  surfaceId: string;
  eventType: 'message_received' | 'message_sent' | 'error' | 'connect' | 'disconnect';
  timestamp: number;
  durationMs?: number;
  messageLength?: number;
  errorType?: string;
};

/** Router configuration */
export type SurfaceRouterConfig = {
  /** Default message handler if no specific handler registered */
  defaultMessageHandler?: MessageHandler;
  /** Enable analytics collection */
  enableAnalytics?: boolean;
  /** Enable hot-reload of surfaces */
  enableHotReload?: boolean;
  /** Permission handler for surfaces without interactive prompts */
  permissionHandler?: (request: PermissionRequest, surfaceId: string) => Promise<PermissionResponse>;
};

/** Active session tracking */
type ActiveSession = {
  surfaceId: string;
  threadId: string;
  startedAt: number;
  lastActivityAt: number;
  messageCount: number;
};

// =============================================================================
// Surface Router
// =============================================================================

/**
 * Central router for surface-agent communication.
 *
 * The router manages:
 * - Surface registration and lifecycle
 * - Message routing between surfaces and agents
 * - Session tracking across surfaces
 * - Analytics collection
 * - Hot-reload of surface configurations
 */
export class SurfaceRouter {
  private registry = new SurfaceRegistry();
  private messageHandler?: MessageHandler;
  private permissionHandler?: (request: PermissionRequest, surfaceId: string) => Promise<PermissionResponse>;
  private activeSessions = new Map<string, ActiveSession>();
  private analytics: SurfaceAnalyticsEvent[] = [];
  private config: SurfaceRouterConfig;
  private eventEmitter = new EventEmitter<{
    message: { surfaceId: string; message: SurfaceMessage };
    response: { surfaceId: string; response: SurfaceResponse };
    error: { surfaceId: string; error: Error };
    analytics: SurfaceAnalyticsEvent;
  }>();
  private hotReloadIntervals = new Map<string, NodeJS.Timeout>();
  private initialized = false;

  constructor(config: SurfaceRouterConfig = {}) {
    this.config = {
      enableAnalytics: true,
      enableHotReload: false,
      ...config,
    };
    this.messageHandler = config.defaultMessageHandler;
    this.permissionHandler = config.permissionHandler;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize the router and connect all registered surfaces.
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    log.info('Initializing surface router');

    // Connect all registered surfaces
    const surfaces = this.registry.getAll();
    for (const surface of surfaces) {
      await this.connectSurface(surface);
    }

    this.initialized = true;
    log.info('Surface router initialized', { surfaceCount: surfaces.length });
  }

  /**
   * Shutdown the router and disconnect all surfaces.
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down surface router');

    // Stop all hot-reload intervals
    for (const [surfaceId, interval] of this.hotReloadIntervals) {
      clearInterval(interval);
      log.debug('Stopped hot-reload for surface', { surfaceId });
    }
    this.hotReloadIntervals.clear();

    // Disconnect all surfaces
    const surfaces = this.registry.getAll();
    for (const surface of surfaces) {
      await this.disconnectSurface(surface);
    }

    this.initialized = false;
    log.info('Surface router shutdown complete');
  }

  // ---------------------------------------------------------------------------
  // Surface Management
  // ---------------------------------------------------------------------------

  /**
   * Register and connect a surface.
   */
  async registerSurface(surface: Surface): Promise<void> {
    log.info('Registering surface', { surfaceId: surface.id, type: surface.name });

    this.registry.register(surface);

    if (this.initialized) {
      await this.connectSurface(surface);
    }

    // Set up hot-reload if enabled
    if (this.config.enableHotReload) {
      this.setupHotReload(surface);
    }
  }

  /**
   * Unregister and disconnect a surface.
   */
  async unregisterSurface(surfaceId: string): Promise<void> {
    const surface = this.registry.get(surfaceId);
    if (!surface) {
      return;
    }

    log.info('Unregistering surface', { surfaceId });

    // Stop hot-reload
    const interval = this.hotReloadIntervals.get(surfaceId);
    if (interval) {
      clearInterval(interval);
      this.hotReloadIntervals.delete(surfaceId);
    }

    await this.disconnectSurface(surface);
    this.registry.unregister(surfaceId);
  }

  /**
   * Get a registered surface by ID.
   */
  getSurface(surfaceId: string): Surface | undefined {
    return this.registry.get(surfaceId);
  }

  /**
   * Get all registered surfaces.
   */
  getAllSurfaces(): Surface[] {
    return this.registry.getAll();
  }

  // ---------------------------------------------------------------------------
  // Message Handling
  // ---------------------------------------------------------------------------

  /**
   * Set the message handler for incoming surface messages.
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Set the permission handler for non-interactive surfaces.
   */
  setPermissionHandler(
    handler: (request: PermissionRequest, surfaceId: string) => Promise<PermissionResponse>
  ): void {
    this.permissionHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private async connectSurface(surface: Surface): Promise<void> {
    try {
      // Subscribe to surface events
      surface.onEvent((event) => this.handleSurfaceEvent(surface, event));

      // Connect the surface
      await surface.connect();

      this.recordAnalytics({
        surfaceId: surface.id,
        eventType: 'connect',
        timestamp: Date.now(),
      });

      log.info('Surface connected', { surfaceId: surface.id });
    } catch (error) {
      log.error('Failed to connect surface', {
        surfaceId: surface.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async disconnectSurface(surface: Surface): Promise<void> {
    try {
      await surface.disconnect();

      this.recordAnalytics({
        surfaceId: surface.id,
        eventType: 'disconnect',
        timestamp: Date.now(),
      });

      log.info('Surface disconnected', { surfaceId: surface.id });
    } catch (error) {
      log.error('Error disconnecting surface', {
        surfaceId: surface.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleSurfaceEvent(surface: Surface, event: SurfaceEvent): void {
    switch (event.type) {
      case 'message':
        this.handleIncomingMessage(surface, event.message);
        break;
      case 'error':
        this.handleSurfaceError(surface, event.error);
        break;
      case 'state_change':
        log.debug('Surface state changed', {
          surfaceId: surface.id,
          state: event.state,
          error: event.error?.message,
        });
        break;
      default:
        // Handle other events
        this.eventEmitter.emit(event.type as any, {
          surfaceId: surface.id,
          ...event,
        });
    }
  }

  private async handleIncomingMessage(surface: Surface, message: SurfaceMessage): Promise<void> {
    const startTime = Date.now();
    const threadId = message.thread?.threadId || 'default';
    const sessionKey = `${surface.id}:${threadId}`;

    // Update session tracking
    this.updateSession(sessionKey, surface.id, threadId);

    // Record analytics
    this.recordAnalytics({
      surfaceId: surface.id,
      eventType: 'message_received',
      timestamp: startTime,
      messageLength: message.body.length,
    });

    // Emit event for observers
    this.eventEmitter.emit('message', { surfaceId: surface.id, message });

    // Route to handler
    if (!this.messageHandler) {
      log.warn('No message handler registered, dropping message', {
        surfaceId: surface.id,
        messageId: message.id,
      });
      return;
    }

    try {
      // Build context
      const context: SurfaceContext = {
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

      // Call handler
      const result = await this.messageHandler(message, context);

      // Send response
      if (Symbol.asyncIterator in result) {
        // Streaming response
        if (surface.capabilities.streaming && surface.sendStreamChunk) {
          for await (const chunk of result as AsyncIterable<StreamChunk>) {
            await surface.sendStreamChunk(chunk, threadId);
          }
        } else {
          // Buffer for non-streaming surfaces
          let fullText = '';
          for await (const chunk of result as AsyncIterable<StreamChunk>) {
            if (chunk.type === 'text' && chunk.text) {
              fullText += chunk.text;
            }
          }
          if (fullText) {
            await surface.sendResponse({ text: fullText }, threadId);
          }
        }
      } else {
        // Single response
        await surface.sendResponse(result as SurfaceResponse, threadId);
      }

      // Record analytics
      const durationMs = Date.now() - startTime;
      this.recordAnalytics({
        surfaceId: surface.id,
        eventType: 'message_sent',
        timestamp: Date.now(),
        durationMs,
      });

      this.eventEmitter.emit('response', {
        surfaceId: surface.id,
        response: result as SurfaceResponse,
      });
    } catch (error) {
      log.error('Error handling message', {
        surfaceId: surface.id,
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });

      this.recordAnalytics({
        surfaceId: surface.id,
        eventType: 'error',
        timestamp: Date.now(),
        errorType: error instanceof Error ? error.name : 'unknown',
      });

      this.eventEmitter.emit('error', {
        surfaceId: surface.id,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      // Send error response to surface if possible
      try {
        await surface.sendResponse(
          {
            text: 'Sorry, I encountered an error processing your message.',
          },
          threadId
        );
      } catch (sendError) {
        log.error('Failed to send error response', {
          surfaceId: surface.id,
          error: sendError instanceof Error ? sendError.message : String(sendError),
        });
      }
    }
  }

  private handleSurfaceError(surface: Surface, error: Error): void {
    log.error('Surface error', {
      surfaceId: surface.id,
      error: error.message,
    });

    this.recordAnalytics({
      surfaceId: surface.id,
      eventType: 'error',
      timestamp: Date.now(),
      errorType: error.name,
    });

    this.eventEmitter.emit('error', { surfaceId: surface.id, error });
  }

  private updateSession(sessionKey: string, surfaceId: string, threadId: string): void {
    const existing = this.activeSessions.get(sessionKey);
    const now = Date.now();

    if (existing) {
      existing.lastActivityAt = now;
      existing.messageCount++;
    } else {
      this.activeSessions.set(sessionKey, {
        surfaceId,
        threadId,
        startedAt: now,
        lastActivityAt: now,
        messageCount: 1,
      });
    }
  }

  private setupHotReload(surface: Surface): void {
    // Check for config changes every 30 seconds
    const interval = setInterval(() => {
      this.checkSurfaceConfig(surface);
    }, 30000);

    this.hotReloadIntervals.set(surface.id, interval);
    log.debug('Hot-reload enabled for surface', { surfaceId: surface.id });
  }

  private async checkSurfaceConfig(surface: Surface): Promise<void> {
    // This is a placeholder for hot-reload logic
    // In a full implementation, this would:
    // 1. Check if surface config files have changed
    // 2. Reload configuration if needed
    // 3. Reconnect surface if necessary
    log.debug('Checking surface config for hot-reload', { surfaceId: surface.id });
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  private recordAnalytics(event: SurfaceAnalyticsEvent): void {
    if (!this.config.enableAnalytics) {
      return;
    }

    this.analytics.push(event);

    // Emit for real-time observers
    this.eventEmitter.emit('analytics', event);

    // Prune old analytics (keep last 10000 events)
    if (this.analytics.length > 10000) {
      this.analytics = this.analytics.slice(-5000);
    }
  }

  /**
   * Get analytics data for all surfaces or a specific surface.
   */
  getAnalytics(surfaceId?: string): SurfaceAnalyticsEvent[] {
    if (surfaceId) {
      return this.analytics.filter((e) => e.surfaceId === surfaceId);
    }
    return [...this.analytics];
  }

  /**
   * Get active sessions.
   */
  getActiveSessions(): ActiveSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Get session statistics.
   */
  getSessionStats(): {
    totalSessions: number;
    totalMessages: number;
    activeSurfaces: number;
  } {
    let totalMessages = 0;
    for (const session of this.activeSessions.values()) {
      totalMessages += session.messageCount;
    }

    return {
      totalSessions: this.activeSessions.size,
      totalMessages,
      activeSurfaces: this.registry.getAll().length,
    };
  }

  // ---------------------------------------------------------------------------
  // Event Subscriptions
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to router events.
   */
  on<K extends keyof typeof this.eventEmitter['events']>(
    event: K,
    handler: (data: (typeof this.eventEmitter)['events'][K]) => void
  ): () => void {
    return this.eventEmitter.on(event, handler);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let globalRouter: SurfaceRouter | null = null;

/**
 * Get or create the global surface router instance.
 */
export function getSurfaceRouter(config?: SurfaceRouterConfig): SurfaceRouter {
  if (!globalRouter) {
    globalRouter = new SurfaceRouter(config);
  }
  return globalRouter;
}

/**
 * Set the global surface router instance.
 */
export function setSurfaceRouter(router: SurfaceRouter): void {
  globalRouter = router;
}

/**
 * Reset the global router (mainly for testing).
 */
export function resetSurfaceRouter(): void {
  globalRouter = null;
}
