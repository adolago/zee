/**
 * Session Module - Core Session Interface
 *
 * Provides the primary session management interface for handling
 * conversation state across all surfaces (CLI, API, SDK).
 *
 * Architecture:
 * - Session: Manages conversation lifecycle and state
 * - Each session has a unique ID and belongs to a project
 * - Sessions contain ordered messages (user/assistant pairs)
 * - Messages contain parts (text, reasoning, tool calls, etc.)
 *
 * Key Features:
 * - Session isolation: Each session has independent state
 * - Multi-session support: Concurrent sessions per user
 * - Session switching: Context preserved during switches
 * - Fork/Clone: Branch conversations at any point
 */

import { EventEmitter } from 'events';
import type {
  SessionId,
  MessageId,
  SessionInfo,
  SessionStatus,
  SessionConfig,
  Message,
  MessageWithParts,
  MessagePart,
  ActiveContext,
  SessionEvent,
  UserMessage,
  AssistantMessage,
} from './types';

// =============================================================================
// Session Interface
// =============================================================================

/**
 * Core session interface defining the contract for session management.
 */
export interface ISession {
  /** Unique session identifier */
  readonly id: SessionId;

  /** Session metadata */
  readonly info: SessionInfo;

  /** Current session status */
  readonly status: SessionStatus;

  /** Active context (cwd, files, preferences) */
  readonly context: ActiveContext;

  // -------------------------------------------------------------------------
  // Lifecycle Methods
  // -------------------------------------------------------------------------

  /**
   * Initialize the session.
   * Sets up initial state and prepares for message processing.
   */
  initialize(): Promise<void>;

  /**
   * Update session metadata.
   * @param updates Partial session info to update
   */
  update(updates: Partial<SessionInfo>): Promise<SessionInfo>;

  /**
   * Touch the session to update the last activity timestamp.
   */
  touch(): Promise<void>;

  /**
   * Archive the session.
   * Marks session as archived but preserves history.
   */
  archive(): Promise<void>;

  /**
   * Delete the session and all associated data.
   */
  delete(): Promise<void>;

  // -------------------------------------------------------------------------
  // Message Management
  // -------------------------------------------------------------------------

  /**
   * Get all messages in the session.
   * @param options Filter options
   */
  getMessages(options?: {
    limit?: number;
    before?: MessageId;
    after?: MessageId;
  }): Promise<MessageWithParts[]>;

  /**
   * Get a specific message by ID.
   * @param messageId Message identifier
   */
  getMessage(messageId: MessageId): Promise<MessageWithParts | null>;

  /**
   * Add a user message to the session.
   * @param message User message data
   */
  addUserMessage(message: Omit<UserMessage, 'id' | 'sessionId'>): Promise<UserMessage>;

  /**
   * Add an assistant message to the session.
   * @param message Assistant message data
   */
  addAssistantMessage(message: Omit<AssistantMessage, 'id' | 'sessionId'>): Promise<AssistantMessage>;

  /**
   * Update an existing message.
   * @param messageId Message to update
   * @param updates Partial message data
   */
  updateMessage(messageId: MessageId, updates: Partial<Message>): Promise<Message>;

  /**
   * Delete a message and its parts.
   * @param messageId Message to delete
   */
  deleteMessage(messageId: MessageId): Promise<void>;

  // -------------------------------------------------------------------------
  // Part Management
  // -------------------------------------------------------------------------

  /**
   * Add a part to a message.
   * @param messageId Target message
   * @param part Part data
   */
  addPart(messageId: MessageId, part: Omit<MessagePart, 'id' | 'sessionId' | 'messageId'>): Promise<MessagePart>;

  /**
   * Update an existing part.
   * @param partId Part to update
   * @param updates Partial part data
   */
  updatePart(partId: string, updates: Partial<MessagePart>): Promise<MessagePart>;

  /**
   * Delete a part.
   * @param partId Part to delete
   */
  deletePart(partId: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Context Management
  // -------------------------------------------------------------------------

  /**
   * Update the active context.
   * @param context New context values
   */
  setContext(context: Partial<ActiveContext>): Promise<ActiveContext>;

  /**
   * Get the current active context.
   */
  getContext(): ActiveContext;

  // -------------------------------------------------------------------------
  // Session Operations
  // -------------------------------------------------------------------------

  /**
   * Fork the session at a specific message.
   * Creates a new session with history up to the specified message.
   * @param messageId Fork point (optional, defaults to latest)
   */
  fork(messageId?: MessageId): Promise<ISession>;

  /**
   * Get child sessions (if this is a parent session).
   */
  getChildren(): Promise<ISession[]>;

  // -------------------------------------------------------------------------
  // Event Handling
  // -------------------------------------------------------------------------

  /**
   * Subscribe to session events.
   * @param event Event type
   * @param handler Event handler
   */
  on<T extends SessionEvent['type']>(
    event: T,
    handler: (payload: Extract<SessionEvent, { type: T }>['payload']) => void,
  ): void;

  /**
   * Unsubscribe from session events.
   * @param event Event type
   * @param handler Event handler
   */
  off<T extends SessionEvent['type']>(
    event: T,
    handler: (payload: Extract<SessionEvent, { type: T }>['payload']) => void,
  ): void;
}

// =============================================================================
// Session Manager Interface
// =============================================================================

/**
 * Session manager interface for multi-session operations.
 */
export interface ISessionManager {
  /**
   * Create a new session.
   * @param options Session creation options
   */
  create(options: {
    projectId: string;
    directory: string;
    parentId?: SessionId;
    title?: string;
    context?: Partial<ActiveContext>;
  }): Promise<ISession>;

  /**
   * Get an existing session.
   * @param sessionId Session identifier
   */
  get(sessionId: SessionId): Promise<ISession | null>;

  /**
   * List all sessions for a project.
   * @param projectId Project identifier
   * @param options Filter options
   */
  list(projectId: string, options?: {
    limit?: number;
    includeArchived?: boolean;
  }): AsyncGenerator<SessionInfo>;

  /**
   * Switch to a different session.
   * Preserves current session state before switching.
   * @param sessionId Target session
   */
  switchTo(sessionId: SessionId): Promise<ISession>;

  /**
   * Get the currently active session.
   */
  getActive(): ISession | null;

  /**
   * Delete a session and all its data.
   * @param sessionId Session to delete
   */
  delete(sessionId: SessionId): Promise<void>;

  /**
   * Get session statistics.
   * @param sessionId Session identifier
   */
  getStats(sessionId: SessionId): Promise<{
    messageCount: number;
    tokenUsage: { input: number; output: number; total: number };
    cost: number;
    duration: number;
  }>;

  // -------------------------------------------------------------------------
  // Event Handling
  // -------------------------------------------------------------------------

  /**
   * Subscribe to manager-level events.
   */
  on(event: 'session-created' | 'session-deleted' | 'session-switched', handler: (session: ISession) => void): void;

  /**
   * Unsubscribe from manager-level events.
   */
  off(event: 'session-created' | 'session-deleted' | 'session-switched', handler: (session: ISession) => void): void;
}

// =============================================================================
// Session Factory
// =============================================================================

/**
 * Factory function type for creating session instances.
 */
export type SessionFactory = (
  info: SessionInfo,
  config: SessionConfig,
  emitter: EventEmitter,
) => ISession;

// =============================================================================
// Default Title Generation
// =============================================================================

const DEFAULT_TITLE_PREFIX = 'New session - ';
const CHILD_TITLE_PREFIX = 'Child session - ';

export function createDefaultTitle(isChild = false): string {
  const prefix = isChild ? CHILD_TITLE_PREFIX : DEFAULT_TITLE_PREFIX;
  return prefix + new Date().toISOString();
}

export function isDefaultTitle(title: string): boolean {
  const pattern = new RegExp(
    `^(${DEFAULT_TITLE_PREFIX}|${CHILD_TITLE_PREFIX})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  );
  return pattern.test(title);
}

// =============================================================================
// Identifier Generation
// =============================================================================

/**
 * Generate a unique ascending identifier.
 * Uses ULID-like format for time-ordered IDs.
 */
export function generateId(prefix: 'session' | 'message' | 'part'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Generate a descending identifier (for reverse chronological ordering).
 */
export function generateDescendingId(prefix: 'session' | 'message' | 'part'): string {
  // Use max timestamp minus current for descending order
  const maxTimestamp = 9999999999999; // ~2286 in milliseconds
  const invertedTimestamp = (maxTimestamp - Date.now()).toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${invertedTimestamp}_${random}`;
}

// =============================================================================
// Usage Calculation
// =============================================================================

export interface UsageMetrics {
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: {
      read: number;
      write: number;
    };
  };
}

export interface ModelCost {
  input: number;  // Cost per 1M tokens
  output: number; // Cost per 1M tokens
  cache?: {
    read: number;
    write: number;
  };
}

/**
 * Calculate usage metrics from LLM response.
 */
export function calculateUsage(
  usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cachedInputTokens?: number },
  modelCost: ModelCost,
  metadata?: Record<string, unknown>,
): UsageMetrics {
  const cachedInputTokens = usage.cachedInputTokens ?? 0;

  // Some providers exclude cached tokens from input count
  const excludesCachedTokens = !!metadata?.['anthropic'];
  const adjustedInputTokens = excludesCachedTokens
    ? (usage.inputTokens ?? 0)
    : (usage.inputTokens ?? 0) - cachedInputTokens;

  const tokens = {
    input: Math.max(0, adjustedInputTokens),
    output: Math.max(0, usage.outputTokens ?? 0),
    reasoning: Math.max(0, usage.reasoningTokens ?? 0),
    cache: {
      read: Math.max(0, cachedInputTokens),
      write: Math.max(
        0,
        (metadata?.['anthropic'] as Record<string, unknown>)?.['cacheCreationInputTokens'] as number ?? 0,
      ),
    },
  };

  const cost =
    (tokens.input * modelCost.input) / 1_000_000 +
    (tokens.output * modelCost.output) / 1_000_000 +
    (tokens.cache.read * (modelCost.cache?.read ?? 0)) / 1_000_000 +
    (tokens.cache.write * (modelCost.cache?.write ?? 0)) / 1_000_000 +
    // Charge reasoning tokens at output rate
    (tokens.reasoning * modelCost.output) / 1_000_000;

  return { cost, tokens };
}
