/**
 * GUI Surface Adapter
 *
 * WebSocket-based connection to desktop GUI applications like Stanley.
 * Supports GPUI-based visual data presentation and real-time streaming.
 */

import { randomUUID } from "node:crypto"

import { BaseSurface, type Surface } from "./surface.js"
import {
  type GUISurfaceConfig,
  resolveGUISurfaceConfig,
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
  type SurfaceMessage,
  type SurfaceResponse,
  type ToolCall,
  type ToolResult,
} from "./types.js"
import { Log } from "../util/log"

const log = Log.create({ service: "gui-surface" })

// =============================================================================
// GUI Surface Capabilities
// =============================================================================

const GUI_CAPABILITIES: SurfaceCapabilities = {
  ...DEFAULT_CAPABILITIES,
  streaming: true,
  interactivePrompts: true,
  richText: true,
  media: true,
  threading: true,
  typingIndicators: true,
  reactions: true,
  messageEditing: true,
  maxMessageLength: 0, // Unlimited
  supportedMediaTypes: ["image/*", "video/*", "audio/*", "application/pdf"],
}

// =============================================================================
// WebSocket Protocol Types
// =============================================================================

/**
 * Message frame sent over WebSocket.
 */
type WSFrame = {
  type: "req" | "res" | "event"
  id?: string
  method?: string
  params?: unknown
  ok?: boolean
  error?: { code: number; message: string }
  payload?: unknown
  event?: string
}

/**
 * Pending request waiting for response.
 */
type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timeout?: NodeJS.Timeout
}

// =============================================================================
// GUI Surface Implementation
// =============================================================================

/**
 * GUI surface adapter for desktop applications.
 *
 * Connects via WebSocket to GPUI-based clients like Stanley.
 */
export class GUISurface extends BaseSurface implements Surface {
  readonly id = "gui"
  readonly name = "Desktop GUI"
  readonly capabilities = GUI_CAPABILITIES

  private config: GUISurfaceConfig
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private permissionPromises = new Map<
    string,
    {
      resolve: (response: PermissionResponse) => void
      timeout?: NodeJS.Timeout
    }
  >()

  constructor(config: Partial<GUISurfaceConfig> = {}) {
    super()
    this.config = resolveGUISurfaceConfig(config)
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async connect(): Promise<void> {
    this.setState("connecting")

    return new Promise((resolve, reject) => {
      try {
        const protocol = this.config.secure ? "wss" : "ws"
        const url = `${protocol}://${this.config.host}:${this.config.port}`

        // Note: In Node.js, use 'ws' package; in browser, use native WebSocket
        // This is a simplified implementation assuming Node.js environment
        const WebSocketImpl = typeof WebSocket !== "undefined" ? WebSocket : require("ws").WebSocket

        const ws = new WebSocketImpl(url)
        this.ws = ws

        ws.onopen = async () => {
          this.reconnectAttempts = 0
          try {
            await this.handshake()
            this.setState("connected")
            resolve()
          } catch (err) {
            reject(err)
          }
        }

        ws.onmessage = (event: { data: string }) => {
          this.handleMessage(event.data)
        }

        ws.onclose = (event: { code: number; reason: string }) => {
          this.handleClose(event.code, event.reason)
        }

        ws.onerror = () => {
          const err = new Error("WebSocket error")
          this.emit({ type: "error", error: err, recoverable: true })
          if (this.state === "connecting") {
            reject(err)
          }
        }
      } catch (err) {
        reject(err)
      }
    })
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    for (const [, pending] of this.pending) {
      if (pending.timeout) clearTimeout(pending.timeout)
      pending.reject(new Error("Connection closed"))
    }
    this.pending.clear()

    for (const [, promise] of this.permissionPromises) {
      if (promise.timeout) clearTimeout(promise.timeout)
    }
    this.permissionPromises.clear()

    if (this.ws) {
      this.ws.close(1000, "Client disconnect")
      this.ws = null
    }

    this.setState("disconnected")
  }

  // ---------------------------------------------------------------------------
  // WebSocket Handling
  // ---------------------------------------------------------------------------

  private async handshake(): Promise<void> {
    const params = {
      version: 1,
      client: {
        name: "agent-core",
        version: "1.0.0",
        platform: process.platform,
      },
      auth: this.config.authToken ? { token: this.config.authToken } : undefined,
    }

    await this.request("connect", params)
  }

  private handleMessage(data: string): void {
    try {
      const frame = JSON.parse(data) as WSFrame

      if (frame.type === "res") {
        this.handleResponse(frame)
      } else if (frame.type === "event") {
        this.handleEvent(frame)
      }
    } catch (err) {
      log.error("Failed to parse WebSocket message", {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private handleResponse(frame: WSFrame): void {
    if (!frame.id) return

    const pending = this.pending.get(frame.id)
    if (!pending) return

    this.pending.delete(frame.id)
    if (pending.timeout) clearTimeout(pending.timeout)

    if (frame.ok) {
      pending.resolve(frame.payload)
    } else {
      pending.reject(new Error(frame.error?.message ?? "Unknown error"))
    }
  }

  private handleEvent(frame: WSFrame): void {
    switch (frame.event) {
      case "message": {
        const payload = frame.payload as Record<string, unknown>
        const message: SurfaceMessage = {
          id: (payload.id as string) || randomUUID(),
          senderId: (payload.senderId as string) || "gui-user",
          senderName: payload.senderName as string,
          body: (payload.body as string) || "",
          timestamp: (payload.timestamp as number) || Date.now(),
          media: payload.media as SurfaceMessage["media"],
          thread: payload.thread as SurfaceMessage["thread"],
        }
        this.emit({ type: "message", message })
        break
      }

      case "permission_response": {
        const payload = frame.payload as Record<string, unknown>
        const requestId = payload.requestId as string
        const promise = this.permissionPromises.get(requestId)
        if (promise) {
          this.permissionPromises.delete(requestId)
          if (promise.timeout) clearTimeout(promise.timeout)
          promise.resolve({
            requestId,
            action: payload.action as PermissionResponse["action"],
            remember: payload.remember as boolean,
          })
        }
        break
      }

      case "abort": {
        this.emit({
          type: "error",
          error: new Error("User requested abort"),
          recoverable: true,
        })
        break
      }

      case "ping": {
        this.send({ type: "event", event: "pong" })
        break
      }
    }
  }

  private handleClose(code: number, reason: string): void {
    this.ws = null

    // Reject all pending requests
    for (const [, pending] of this.pending) {
      if (pending.timeout) clearTimeout(pending.timeout)
      pending.reject(new Error(`Connection closed: ${reason}`))
    }
    this.pending.clear()

    // Attempt reconnection if enabled
    if (
      this.config.reconnect.enabled &&
      this.reconnectAttempts < this.config.reconnect.maxAttempts &&
      code !== 1000 // Normal close
    ) {
      this.scheduleReconnect()
    } else {
      this.setState("disconnected")
    }
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting")

    const delay = Math.min(
      this.config.reconnect.backoffMs * Math.pow(2, this.reconnectAttempts),
      this.config.reconnect.maxBackoffMs,
    )

    this.reconnectAttempts++

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect()
      } catch {
        // connect() will emit error and potentially schedule another reconnect
      }
    }, delay)
  }

  private send(frame: WSFrame): void {
    if (!this.ws || this.ws.readyState !== 1 /* WebSocket.OPEN */) {
      throw new Error("WebSocket not connected")
    }
    this.ws.send(JSON.stringify(frame))
  }

  private async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = randomUUID()

      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timed out: ${method}`))
      }, 30_000)

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      })

      try {
        this.send({ type: "req", id, method, params })
      } catch (err) {
        this.pending.delete(id)
        clearTimeout(timeout)
        reject(err)
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Message Handling
  // ---------------------------------------------------------------------------

  async sendResponse(response: SurfaceResponse, threadId?: string): Promise<void> {
    await this.request("send_response", {
      ...response,
      threadId,
    })
  }

  override async sendStreamChunk(chunk: StreamChunk, threadId?: string): Promise<void> {
    // For GUI, we send stream events instead of requests
    this.send({
      type: "event",
      event: "stream_chunk",
      payload: { ...chunk, threadId },
    })
  }

  override async sendTypingIndicator(threadId?: string): Promise<void> {
    this.send({
      type: "event",
      event: "typing",
      payload: { threadId },
    })
  }

  // ---------------------------------------------------------------------------
  // Permission Handling
  // ---------------------------------------------------------------------------

  async requestPermission(request: PermissionRequest): Promise<PermissionResponse> {
    const permissionConfig = mergePermissionConfig(DEFAULT_PERMISSION_CONFIG, this.config.permissions)

    // Resolve automatic permission
    const resolved = resolvePermission(request.type, request.description, permissionConfig)

    // If no confirmation needed, apply automatically
    if (!resolved.requiresConfirmation) {
      return {
        requestId: request.id,
        action: resolved.action,
      }
    }

    // Send permission request to GUI and wait for response
    return new Promise((resolve) => {
      const timeoutMs = resolved.timeoutMs || request.timeoutMs || 60_000

      const timeout = setTimeout(() => {
        this.permissionPromises.delete(request.id)
        resolve({
          requestId: request.id,
          action: request.defaultAction,
        })
      }, timeoutMs)

      this.permissionPromises.set(request.id, { resolve, timeout })

      this.send({
        type: "event",
        event: "permission_request",
        payload: request,
      })
    })
  }

  // ---------------------------------------------------------------------------
  // Tool Notifications
  // ---------------------------------------------------------------------------

  override async notifyToolStart(toolCall: ToolCall): Promise<void> {
    this.send({
      type: "event",
      event: "tool_start",
      payload: toolCall,
    })
  }

  override async notifyToolEnd(result: ToolResult): Promise<void> {
    this.send({
      type: "event",
      event: "tool_end",
      payload: result,
    })
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a GUI surface instance.
 */
export function createGUISurface(config?: Partial<GUISurfaceConfig>): GUISurface {
  return new GUISurface(config)
}
