/**
 * Messaging Surface Adapter
 *
 * Unified adapter for messaging platforms (WhatsApp/Telegram).
 * Handles non-streaming (message batching) and automatic permission resolution.
 */

import { BaseSurface, type Surface } from "./surface.js"
import {
  type MessagingSurfaceConfig,
  resolveMessagingSurfaceConfig,
  DEFAULT_PERMISSION_CONFIG,
  mergePermissionConfig,
  resolvePermission,
} from "./config.js"
import {
  DEFAULT_CAPABILITIES,
  type PermissionRequest,
  type PermissionResponse,
  type StreamChunk,
  type SurfaceCapabilities,
  type SurfaceMedia,
  type SurfaceMessage,
  type SurfaceResponse,
  type ToolCall,
  type ToolResult,
  type ThreadContext,
} from "./types.js"
import { Log } from "../util/log"

const log = Log.create({ service: "messaging-surface" })

// =============================================================================
// Messaging Platform Handlers
// =============================================================================

/**
 * Platform-specific message handler interface.
 */
export interface MessagingPlatformHandler {
  /** Platform identifier */
  readonly platform: "whatsapp" | "telegram"

  /** Connect to the platform */
  connect(): Promise<void>

  /** Disconnect from the platform */
  disconnect(): Promise<void>

  /** Send a message */
  sendMessage(
    target: string,
    text: string,
    options?: {
      replyToId?: string
      media?: SurfaceMedia[]
    },
  ): Promise<void>

  /** Send typing indicator */
  sendTyping(target: string): Promise<void>

  /** Start a live streaming message (optional). */
  startStreamingMessage?(target: string, text: string, options?: { replyToId?: string }): Promise<string>

  /** Update a live streaming message (optional). */
  updateStreamingMessage?(target: string, handle: string, text: string): Promise<void>

  /** Finalize a live streaming message (optional). */
  finalizeStreamingMessage?(
    target: string,
    handle: string,
    text: string,
    options?: { replyToId?: string },
  ): Promise<void>

  /** Register message handler */
  onMessage(handler: (message: PlatformMessage) => void): () => void
}

/**
 * Message from a messaging platform.
 */
export type PlatformMessage = {
  id: string
  senderId: string
  senderName?: string
  body: string
  timestamp: number
  media?: SurfaceMedia[]
  isGroup: boolean
  groupId?: string
  groupName?: string
  replyToId?: string
  wasMentioned?: boolean
  platform: "whatsapp" | "telegram"
}

// =============================================================================
// Messaging Surface Capabilities
// =============================================================================

const MESSAGING_CAPABILITIES: SurfaceCapabilities = {
  ...DEFAULT_CAPABILITIES,
  streaming: false, // Messaging platforms don't support streaming
  interactivePrompts: false, // Can't prompt users for permissions
  richText: true, // Most support markdown
  media: true,
  threading: true,
  typingIndicators: true,
  reactions: true,
  messageEditing: false, // Limited editing support
  maxMessageLength: 4096, // Default, varies by platform
  supportedMediaTypes: ["image/*", "video/*", "audio/*", "application/pdf"],
  showThinking: false, // CRITICAL: Reasoning/thinking output must never be shown on messaging platforms
}

// Platform-specific capability overrides
const PLATFORM_CAPABILITIES: Record<string, Partial<SurfaceCapabilities>> = {
  whatsapp: {
    maxMessageLength: 65536,
    reactions: true,
    messageEditing: false,
    showThinking: false, // Locked: never show thinking on WhatsApp (enforced at multiple layers)
  },
  telegram: {
    streaming: true,
    richText: true,
    maxMessageLength: 4096,
    reactions: true,
    messageEditing: true,
    showThinking: false,
  },
}

// =============================================================================
// Message Batching
// =============================================================================

/**
 * Batches streaming chunks into complete messages for non-streaming surfaces.
 */
class MessageBatcher {
  private buffer = ""
  private media: SurfaceMedia[] = []
  private toolOutputs: string[] = []
  private replyToId?: string

  append(chunk: StreamChunk): void {
    if (chunk.type === "text" && chunk.text) {
      this.buffer += chunk.text
    } else if (chunk.type === "tool_end" && chunk.tool?.output) {
      const output = typeof chunk.tool.output === "string" ? chunk.tool.output : JSON.stringify(chunk.tool.output)
      this.toolOutputs.push(`[${chunk.tool.name}]: ${this.truncate(output, 200)}`)
    }
  }

  setReplyTo(messageId: string): void {
    this.replyToId = messageId
  }

  addMedia(media: SurfaceMedia): void {
    this.media.push(media)
  }

  flush(): SurfaceResponse | null {
    const text = this.buffer.trim()
    const hasContent = text || this.media.length > 0

    if (!hasContent) {
      return null
    }

    const response: SurfaceResponse = {
      text: text || undefined,
      media: this.media.length > 0 ? this.media : undefined,
      replyToId: this.replyToId,
    }

    // Reset
    this.buffer = ""
    this.media = []
    this.toolOutputs = []
    this.replyToId = undefined

    return response
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen - 3) + "..."
  }
}

type LiveStreamState = {
  handle?: string
  text: string
  lastUpdateAtMs: number
}

// =============================================================================
// Messaging Surface Implementation
// =============================================================================

/**
 * Unified messaging surface adapter.
 *
 * Handles messaging channels with a common interface.
 */
export class MessagingSurface extends BaseSurface implements Surface {
  readonly id: string
  readonly name: string
  readonly capabilities: SurfaceCapabilities

  private config: MessagingSurfaceConfig
  private platform: MessagingPlatformHandler
  private batcher = new MessageBatcher()
  private liveStream = new Map<string, LiveStreamState>()
  private typingInterval: NodeJS.Timeout | null = null
  private unsubscribe: (() => void) | null = null

  constructor(platform: MessagingPlatformHandler, config: Partial<MessagingSurfaceConfig> = {}) {
    super()
    this.platform = platform
    this.config = resolveMessagingSurfaceConfig(config, { platform: platform.platform })
    this.id = `messaging:${platform.platform}`
    this.name = this.formatPlatformName(platform.platform)

    // Merge platform-specific capabilities
    const platformCaps = PLATFORM_CAPABILITIES[platform.platform] || {}
    this.capabilities = {
      ...MESSAGING_CAPABILITIES,
      ...platformCaps,
      maxMessageLength: config.maxMessageLength || platformCaps.maxMessageLength || 4096,
    }
  }

  private formatPlatformName(platform: string): string {
    const names: Record<string, string> = {
      whatsapp: "WhatsApp",
      telegram: "Telegram",
    }
    return names[platform] || platform
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async connect(): Promise<void> {
    this.setState("connecting")

    try {
      await this.platform.connect()

      // Subscribe to platform messages
      this.unsubscribe = this.platform.onMessage((msg) => {
        this.handlePlatformMessage(msg)
      })

      this.setState("connected")
    } catch (err) {
      this.setState("error", err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.stopTypingLoop()
    this.liveStream.clear()
    this.unsubscribe?.()
    await this.platform.disconnect()
    this.setState("disconnected")
  }

  // ---------------------------------------------------------------------------
  // Message Handling
  // ---------------------------------------------------------------------------

  private handlePlatformMessage(msg: PlatformMessage): void {
    // Check if sender is allowed
    if (!this.isAllowedSender(msg)) {
      return
    }

    // Check group settings
    if (msg.isGroup && !this.isAllowedGroup(msg)) {
      return
    }

    // Check mention requirement
    if (msg.isGroup && this.config.groups.requireMention && !msg.wasMentioned) {
      return
    }

    // Convert to surface message
    const thread: ThreadContext = {
      threadId: msg.isGroup ? msg.groupId || msg.senderId : msg.senderId,
      isGroup: msg.isGroup,
      groupName: msg.groupName,
      replyToId: msg.replyToId,
      wasMentioned: msg.wasMentioned,
    }

    const message: SurfaceMessage = {
      id: msg.id,
      senderId: msg.senderId,
      senderName: msg.senderName,
      body: msg.body,
      timestamp: msg.timestamp,
      media: msg.media,
      thread,
      metadata: { platform: msg.platform },
    }

    this.emit({ type: "message", message })
  }

  private isAllowedSender(msg: PlatformMessage): boolean {
    if (this.config.allowedSenders.length === 0) return true
    if (this.config.allowedSenders.includes("*")) return true
    // Normalize phone numbers: strip leading '+' for comparison
    // (Cloud API sends bare numbers, configs often use +prefix)
    const normalized = msg.senderId.replace(/^\+/, "")
    return this.config.allowedSenders.some((s) => s === msg.senderId || s.replace(/^\+/, "") === normalized)
  }

  private isAllowedGroup(msg: PlatformMessage): boolean {
    if (!this.config.groups.enabled) return false
    if (this.config.groups.allowedGroups.length === 0) return true
    if (this.config.groups.allowedGroups.includes("*")) return true
    if (!msg.groupId) return false
    return this.config.groups.allowedGroups.includes(msg.groupId)
  }

  // ---------------------------------------------------------------------------
  // Response Handling
  // ---------------------------------------------------------------------------

  async sendResponse(response: SurfaceResponse, threadId?: string): Promise<void> {
    if (!threadId) {
      log.warn("No threadId provided, cannot send response")
      return
    }

    this.stopTypingLoop()

    // Handle text
    if (response.text) {
      const chunks = this.chunkMessage(response.text)
      for (let i = 0; i < chunks.length; i++) {
        await this.platform.sendMessage(threadId, chunks[i], {
          replyToId: i === 0 ? response.replyToId : undefined,
        })

        // Small delay between chunks
        if (i < chunks.length - 1 && this.config.chunkDelayMs > 0) {
          await this.delay(this.config.chunkDelayMs)
        }
      }
    }

    // Handle media
    if (response.media) {
      for (const media of response.media) {
        await this.platform.sendMessage(threadId, "", { media: [media] })
      }
    }
  }

  override async sendStreamChunk(chunk: StreamChunk, threadId?: string): Promise<void> {
    if (!threadId) {
      this.batcher.append(chunk)
      if (chunk.isFinal) {
        this.batcher.flush()
      }
      return
    }

    // Non-streaming platforms still receive a single final message.
    if (!this.capabilities.streaming) {
      this.batcher.append(chunk)
      if (chunk.isFinal) {
        const response = this.batcher.flush()
        if (response) await this.sendResponse(response, threadId)
      }
      return
    }

    if (chunk.type === "text" && chunk.text) {
      const state = this.ensureLiveStreamState(threadId)
      state.text += chunk.text
      const now = Date.now()
      const shouldUpdate = now - state.lastUpdateAtMs >= this.config.streamEditIntervalMs
      if (shouldUpdate) {
        await this.upsertLiveStreamMessage(threadId, state)
      }
    }

    if (chunk.isFinal) {
      await this.finalizeLiveStream(threadId)
    }
  }

  override async sendTypingIndicator(threadId?: string): Promise<void> {
    if (!threadId || !this.config.showTyping) return

    // Start typing loop
    this.startTypingLoop(threadId)
  }

  private startTypingLoop(threadId: string): void {
    if (this.typingInterval) return

    // Send immediately
    void this.platform.sendTyping(threadId)

    // Then repeat at interval
    this.typingInterval = setInterval(() => {
      void this.platform.sendTyping(threadId)
    }, this.config.typingIntervalMs)
  }

  private stopTypingLoop(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval)
      this.typingInterval = null
    }
  }

  // ---------------------------------------------------------------------------
  // Permission Handling
  // ---------------------------------------------------------------------------

  async requestPermission(request: PermissionRequest): Promise<PermissionResponse> {
    // Messaging surfaces cannot prompt interactively
    // Always apply automatic resolution based on config
    const permissionConfig = mergePermissionConfig(DEFAULT_PERMISSION_CONFIG, this.config.permissions)

    const resolved = resolvePermission(request.type, request.description, permissionConfig)

    return {
      requestId: request.id,
      action: resolved.action,
    }
  }

  // ---------------------------------------------------------------------------
  // Tool Notifications
  // ---------------------------------------------------------------------------

  override async notifyToolStart(_toolCall: ToolCall): Promise<void> {
    // For messaging, we just maintain typing indicator
    // Tool details are not shown unless configured
  }

  override async notifyToolEnd(_result: ToolResult): Promise<void> {
    // Optionally include tool output in batched response
    // This is handled by the batcher when processing stream chunks
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private chunkMessage(text: string): string[] {
    const maxLen = this.capabilities.maxMessageLength
    if (!maxLen || text.length <= maxLen) {
      return [text]
    }

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining)
        break
      }

      // Try to break at a natural point
      let breakPoint = remaining.lastIndexOf("\n", maxLen)
      if (breakPoint < maxLen * 0.5) {
        breakPoint = remaining.lastIndexOf(" ", maxLen)
      }
      if (breakPoint < maxLen * 0.5) {
        breakPoint = maxLen
      }

      chunks.push(remaining.slice(0, breakPoint))
      remaining = remaining.slice(breakPoint).trimStart()
    }

    return chunks
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private ensureLiveStreamState(threadId: string): LiveStreamState {
    let state = this.liveStream.get(threadId)
    if (!state) {
      state = {
        text: "",
        lastUpdateAtMs: 0,
      }
      this.liveStream.set(threadId, state)
    }
    return state
  }

  private async upsertLiveStreamMessage(threadId: string, state: LiveStreamState): Promise<void> {
    const text = state.text.trim() || "..."
    if (!state.handle) {
      if (!this.platform.startStreamingMessage) {
        await this.platform.sendMessage(threadId, text)
        state.lastUpdateAtMs = Date.now()
        return
      }
      state.handle = await this.platform.startStreamingMessage(threadId, text)
      state.lastUpdateAtMs = Date.now()
      return
    }

    if (this.platform.updateStreamingMessage) {
      await this.platform.updateStreamingMessage(threadId, state.handle, text)
      state.lastUpdateAtMs = Date.now()
    }
  }

  private async finalizeLiveStream(threadId: string): Promise<void> {
    const state = this.liveStream.get(threadId)
    this.liveStream.delete(threadId)
    const finalText = state?.text?.trim() || "No text response returned."

    if (!state?.handle) {
      await this.platform.sendMessage(threadId, finalText)
      return
    }

    if (this.platform.finalizeStreamingMessage) {
      await this.platform.finalizeStreamingMessage(threadId, state.handle, finalText)
      return
    }

    if (this.platform.updateStreamingMessage) {
      await this.platform.updateStreamingMessage(threadId, state.handle, finalText)
      return
    }

    await this.platform.sendMessage(threadId, finalText)
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a messaging surface with a platform handler.
 *
 * Platform handlers must be provided by the application.
 * WhatsApp messaging is handled via wacli (personal WhatsApp bridge).
 */
export function createMessagingSurface(
  platform: MessagingPlatformHandler,
  config?: Partial<MessagingSurfaceConfig>,
): MessagingSurface {
  return new MessagingSurface(platform, config)
}
