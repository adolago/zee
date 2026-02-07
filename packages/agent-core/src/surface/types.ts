/**
 * Surface Abstraction Layer - Core Types
 *
 * Defines the contracts for surface adapters that connect different UIs
 * (CLI, GUI, messaging platforms) to the unified agent core.
 */

// =============================================================================
// Message Types
// =============================================================================

/**
 * Inbound message from any surface to the agent core.
 */
export type SurfaceMessage = {
  /** Unique message identifier from the surface */
  id: string
  /** Surface-specific sender identifier */
  senderId: string
  /** Human-readable sender name */
  senderName?: string
  /** Message content */
  body: string
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Attached media paths or URLs */
  media?: SurfaceMedia[]
  /** Thread/conversation context */
  thread?: ThreadContext
  /** Surface-specific metadata */
  metadata?: Record<string, unknown>
}

/**
 * Media attachment from a surface.
 */
export type SurfaceMedia = {
  /** Local file path or remote URL */
  path: string
  /** MIME type if known */
  mimeType?: string
  /** Original filename */
  filename?: string
  /** Size in bytes */
  size?: number
}

/**
 * Thread/conversation context for message continuity.
 */
export type ThreadContext = {
  /** Thread or conversation identifier */
  threadId: string
  /** Whether this is a group/channel conversation */
  isGroup: boolean
  /** Group/channel name if applicable */
  groupName?: string
  /** Message being replied to */
  replyToId?: string
  /** Whether the agent was explicitly mentioned */
  wasMentioned?: boolean
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * Outbound response from agent to surface.
 */
export type SurfaceResponse = {
  /** Response text content */
  text?: string
  /** Media to send */
  media?: SurfaceMedia[]
  /** Message to reply to (for threading) */
  replyToId?: string
  /** Whether this is a partial/streaming chunk */
  isPartial?: boolean
  /** Response metadata */
  metadata?: ResponseMetadata
}

/**
 * Metadata attached to responses for observability.
 */
export type ResponseMetadata = {
  /** Model used for generation */
  model?: string
  /** Token usage statistics */
  tokens?: {
    input: number
    output: number
    total: number
  }
  /** Processing duration in milliseconds */
  durationMs?: number
  /** Tools that were invoked */
  toolsUsed?: string[]
}

// =============================================================================
// Tool Call Types
// =============================================================================

/**
 * Tool invocation from the agent that may require surface interaction.
 */
export type ToolCall = {
  /** Unique tool call identifier */
  id: string
  /** Tool name */
  name: string
  /** Tool input parameters */
  input: Record<string, unknown>
  /** Whether this tool requires user confirmation */
  requiresConfirmation: boolean
}

/**
 * Result of a tool execution.
 */
export type ToolResult = {
  /** Corresponding tool call ID */
  callId: string
  /** Whether the tool succeeded */
  success: boolean
  /** Tool output (success case) */
  output?: unknown
  /** Error message (failure case) */
  error?: string
  /** Whether the user denied the tool execution */
  userDenied?: boolean
}

// =============================================================================
// Permission Types
// =============================================================================

/**
 * Permission request from agent to surface.
 */
export type PermissionRequest = {
  /** Unique request identifier */
  id: string
  /** Type of permission being requested */
  type: PermissionType
  /** Human-readable description of what's being requested */
  description: string
  /** Associated tool call if applicable */
  toolCall?: ToolCall
  /** Default action if user doesn't respond */
  defaultAction: PermissionAction
  /** Timeout in milliseconds before applying default */
  timeoutMs?: number
}

export type PermissionType =
  | "file_read"
  | "file_write"
  | "file_delete"
  | "execute_command"
  | "network_request"
  | "tool_execution"
  | "sensitive_data"

export type PermissionAction = "allow" | "deny" | "allow_session" | "deny_session"

/**
 * User's response to a permission request.
 */
export type PermissionResponse = {
  /** Corresponding request ID */
  requestId: string
  /** User's decision */
  action: PermissionAction
  /** Whether to remember this decision */
  remember?: boolean
}

// =============================================================================
// Stream Types
// =============================================================================

/**
 * Streaming chunk from the agent during response generation.
 */
export type StreamChunk = {
  /** Chunk type */
  type: "text" | "tool_start" | "tool_end" | "thinking" | "error"
  /** Text content for text chunks */
  text?: string
  /** Tool information for tool chunks */
  tool?: {
    id: string
    name: string
    input?: Record<string, unknown>
    output?: unknown
    error?: string
  }
  /** Whether this is the final chunk */
  isFinal?: boolean
}

// =============================================================================
// Surface Lifecycle Types
// =============================================================================

/**
 * Surface connection state.
 */
export type SurfaceState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error"

/**
 * Surface lifecycle events.
 */
export type SurfaceEvent =
  | { type: "state_change"; state: SurfaceState; error?: Error }
  | { type: "message"; message: SurfaceMessage }
  | { type: "typing"; senderId: string; threadId?: string }
  | { type: "presence"; senderId: string; status: "online" | "offline" }
  | { type: "error"; error: Error; recoverable: boolean }

// =============================================================================
// Surface Capabilities
// =============================================================================

/**
 * Capabilities that a surface supports.
 */
export type SurfaceCapabilities = {
  /** Whether the surface supports streaming responses */
  streaming: boolean
  /** Whether the surface can display interactive permission prompts */
  interactivePrompts: boolean
  /** Whether the surface supports rich text (markdown, formatting) */
  richText: boolean
  /** Whether the surface supports media attachments */
  media: boolean
  /** Whether the surface supports message threading */
  threading: boolean
  /** Whether the surface supports typing indicators */
  typingIndicators: boolean
  /** Whether the surface supports message reactions */
  reactions: boolean
  /** Whether the surface supports message editing */
  messageEditing: boolean
  /** Maximum message length (0 = unlimited) */
  maxMessageLength: number
  /** Supported media types */
  supportedMediaTypes: string[]
  /** Whether thinking/reasoning output can be shown (false = always hidden, true = user toggleable) */
  showThinking?: boolean
}

/**
 * Default capabilities for surfaces that don't specify.
 */
export const DEFAULT_CAPABILITIES: SurfaceCapabilities = {
  streaming: false,
  interactivePrompts: false,
  richText: false,
  media: false,
  threading: false,
  typingIndicators: false,
  reactions: false,
  messageEditing: false,
  maxMessageLength: 0,
  supportedMediaTypes: [],
  showThinking: false,
}

// =============================================================================
// Surface Type
// =============================================================================

export type SurfaceType = "cli" | "web" | "api" | "whatsapp" | "matrix"

// =============================================================================
// Surface Adapter Interface
// =============================================================================

/** Context for message handling */
export interface MessageContext {
  sessionId: string
  threadId?: string
  replyToId?: string
  senderId: string
}

/** Surface adapter interface */
export interface SurfaceAdapter {
  id: string
  type: SurfaceType
  capabilities: SurfaceCapabilities
  state: SurfaceState

  connect(): Promise<void>
  disconnect(): Promise<void>
  send(response: SurfaceResponse, context: MessageContext): Promise<void>
  sendStream?(chunks: AsyncIterable<StreamChunk>, context: MessageContext): Promise<void>
  requestPermission?(request: PermissionRequest, context: MessageContext): Promise<PermissionAction>
  showTyping?(context: MessageContext): Promise<void>
  on<E extends SurfaceEvent["type"]>(event: E, handler: (event: Extract<SurfaceEvent, { type: E }>) => void): () => void
}

// =============================================================================
// Pre-defined Surface Capabilities
// =============================================================================

export const CLI_CAPABILITIES: SurfaceCapabilities = {
  streaming: true,
  interactivePrompts: true,
  richText: true,
  media: false,
  threading: false,
  typingIndicators: false,
  reactions: false,
  messageEditing: false,
  maxMessageLength: 0,
  supportedMediaTypes: [],
  showThinking: true,
}

export const WEB_CAPABILITIES: SurfaceCapabilities = {
  streaming: true,
  interactivePrompts: true,
  richText: true,
  media: true,
  threading: true,
  typingIndicators: true,
  reactions: true,
  messageEditing: true,
  maxMessageLength: 0,
  supportedMediaTypes: ["image/*", "application/pdf", "text/*"],
  showThinking: true,
}

export const WHATSAPP_CAPABILITIES: SurfaceCapabilities = {
  streaming: false,
  interactivePrompts: false,
  richText: false,
  media: true,
  threading: true,
  typingIndicators: true,
  reactions: true,
  messageEditing: false,
  maxMessageLength: 65536,
  supportedMediaTypes: ["image/*", "audio/*", "video/*", "application/pdf"],
  showThinking: false,
}

export const MATRIX_CAPABILITIES: SurfaceCapabilities = {
  streaming: false,
  interactivePrompts: false,
  richText: true,
  media: true,
  threading: true,
  typingIndicators: true,
  reactions: true,
  messageEditing: true,
  maxMessageLength: 65536,
  supportedMediaTypes: ["image/*", "audio/*", "video/*", "application/*"],
  showThinking: false,
}

export const API_CAPABILITIES: SurfaceCapabilities = {
  streaming: true,
  interactivePrompts: false,
  richText: true,
  media: true,
  threading: true,
  typingIndicators: false,
  reactions: false,
  messageEditing: false,
  maxMessageLength: 0,
  supportedMediaTypes: ["*/*"],
  showThinking: true,
}

// =============================================================================
// Surface Response Formatting
// =============================================================================

/**
 * Format content for a specific surface's capabilities.
 *
 * - Strips markdown when richText is false
 * - Splits long responses when maxMessageLength > 0
 * - Converts image references to text descriptions when media is false
 */
export function formatForSurface(content: string, capabilities: SurfaceCapabilities): string[] {
  let formatted = content

  // Strip markdown formatting if surface does not support rich text
  if (!capabilities.richText) {
    formatted = stripMarkdown(formatted)
  }

  // Convert image/media references to text descriptions if media not supported
  if (!capabilities.media) {
    formatted = formatted.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => (alt ? `[Image: ${alt}]` : "[Image]"))
  }

  // Split into chunks if max message length is set
  if (capabilities.maxMessageLength > 0 && formatted.length > capabilities.maxMessageLength) {
    return splitMessage(formatted, capabilities.maxMessageLength)
  }

  return [formatted]
}

/**
 * Strip markdown formatting to plain text.
 */
function stripMarkdown(text: string): string {
  return (
    text
      // Remove code blocks (``` ... ```) - replace with content only
      .replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => code.trim())
      // Remove inline code
      .replace(/`([^`]+)`/g, "$1")
      // Remove bold/italic
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      // Remove headings markers
      .replace(/^#{1,6}\s+/gm, "")
      // Remove link formatting, keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove horizontal rules
      .replace(/^---+$/gm, "")
      // Remove blockquotes markers
      .replace(/^>\s*/gm, "")
      // Remove bullet markers but keep indentation
      .replace(/^(\s*)[-*+]\s+/gm, "$1- ")
  )
}

/**
 * Split a message into chunks respecting word boundaries.
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxLength) {
    // Try to split at a newline or space near the limit
    let splitIndex = remaining.lastIndexOf("\n", maxLength)
    if (splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf(" ", maxLength)
    }
    if (splitIndex < maxLength * 0.3) {
      // No good break point; hard split
      splitIndex = maxLength
    }

    chunks.push(remaining.slice(0, splitIndex).trimEnd())
    remaining = remaining.slice(splitIndex).trimStart()
  }

  if (remaining.length > 0) {
    chunks.push(remaining)
  }

  return chunks
}
