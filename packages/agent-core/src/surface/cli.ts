/**
 * CLI/TUI Surface Adapter
 *
 * Terminal-based interaction with streaming text output and interactive permission prompts.
 * Designed for agent-core and similar terminal-based agent interfaces.
 *
 * NO_COLOR Support:
 * This surface respects the NO_COLOR environment variable (https://no-color.org/).
 * When NO_COLOR is set:
 * - All ANSI color codes are disabled
 * - ASCII spinner characters are used instead of Unicode
 * - Plain text formatting is used for all output
 * Use FORCE_COLOR to explicitly enable colors.
 */

import { createInterface, type Interface as ReadlineInterface } from "node:readline"
import { stdin, stdout, env } from "node:process"

import { BaseSurface, type Surface } from "./surface.js"
import {
  type CLISurfaceConfig,
  resolveCLISurfaceConfig,
  DEFAULT_PERMISSION_CONFIG,
  mergePermissionConfig,
  resolvePermission,
} from "./config.js"
import {
  DEFAULT_CAPABILITIES,
  type PermissionAction,
  type PermissionRequest,
  type PermissionResponse,
  type StreamChunk,
  type SurfaceCapabilities,
  type SurfaceMessage,
  type SurfaceResponse,
  type ToolCall,
  type ToolResult,
} from "./types.js"

// =============================================================================
// NO_COLOR Detection
// =============================================================================

/**
 * Determine if colors should be used based on environment variables.
 * Follows the no-color.org standard.
 */
function shouldUseColors(): boolean {
  if (env.NO_COLOR !== undefined) return false
  if (env.FORCE_COLOR !== undefined) return true
  return stdout.isTTY ?? false
}

/**
 * Determine if Unicode characters should be used.
 * When NO_COLOR is set, defaults to ASCII for consistent plain-text output.
 */
function shouldUseUnicode(): boolean {
  if (env.NO_COLOR !== undefined) return false
  return stdout.isTTY ?? false
}

// =============================================================================
// CLI Surface Capabilities
// =============================================================================

const CLI_CAPABILITIES: SurfaceCapabilities = {
  ...DEFAULT_CAPABILITIES,
  streaming: true,
  interactivePrompts: true,
  richText: true, // Terminal can support ANSI
  media: false, // Terminal can't display media inline
  threading: false, // No thread concept in CLI
  typingIndicators: true, // Can show spinner/progress
  reactions: false,
  messageEditing: false,
  maxMessageLength: 0, // Unlimited
  supportedMediaTypes: [], // No media support
}

// =============================================================================
// CLI Surface Implementation
// =============================================================================

/**
 * CLI/TUI surface adapter for terminal-based agent interaction.
 */
export class CLISurface extends BaseSurface implements Surface {
  readonly id = "cli"
  readonly name = "Command Line Interface"
  readonly capabilities = CLI_CAPABILITIES

  private config: CLISurfaceConfig
  private readline: ReadlineInterface | null = null
  private spinnerInterval: NodeJS.Timeout | null = null
  // Use ASCII spinner when NO_COLOR is set, Unicode otherwise
  private spinnerFrames: string[]
  private spinnerIndex = 0
  private isStreaming = false
  private streamBuffer = ""
  private abortController: AbortController | null = null
  private useColors: boolean

  constructor(config: Partial<CLISurfaceConfig> = {}) {
    super()
    this.config = resolveCLISurfaceConfig(config)
    this.useColors = this.config.colors && shouldUseColors()
    // Choose spinner frames based on Unicode support (NO_COLOR disables Unicode)
    this.spinnerFrames = shouldUseUnicode() ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] : ["|", "/", "-", "\\"]
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async connect(): Promise<void> {
    this.setState("connecting")

    try {
      this.readline = createInterface({
        input: stdin,
        output: stdout,
        terminal: true,
      })

      this.abortController = new AbortController()

      // Handle Ctrl+C gracefully
      this.readline.on("SIGINT", () => {
        this.handleAbort()
      })

      // Handle line input
      this.readline.on("line", (line) => {
        this.handleInput(line)
      })

      // Handle close
      this.readline.on("close", () => {
        this.emit({ type: "state_change", state: "disconnected" })
      })

      this.setState("connected")
      this.showPrompt()
    } catch (err) {
      this.setState("error", err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.abortController?.abort()
    this.stopSpinner()
    this.readline?.close()
    this.readline = null
    this.setState("disconnected")
  }

  // ---------------------------------------------------------------------------
  // Input Handling
  // ---------------------------------------------------------------------------

  private handleInput(line: string): void {
    const trimmed = line.trim()

    // Emit message event
    const message: SurfaceMessage = {
      id: `cli-${Date.now()}`,
      senderId: "cli-user",
      senderName: "User",
      body: trimmed,
      timestamp: Date.now(),
    }

    this.emit({ type: "message", message })
  }

  private handleAbort(): void {
    if (this.isStreaming) {
      this.abortController?.abort()
      this.abortController = new AbortController()
      this.write("\n" + this.format("Aborted.", "dim") + "\n")
      this.isStreaming = false
      this.showPrompt()
    } else {
      // Double Ctrl+C to exit
      this.write("\n(Press Ctrl+C again to exit)\n")
      this.readline?.once("SIGINT", () => {
        this.disconnect()
        process.exit(0)
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------

  async sendResponse(response: SurfaceResponse, _threadId?: string): Promise<void> {
    this.stopSpinner()

    if (response.text) {
      const formatted = this.formatResponse(response.text)
      this.write(formatted + "\n")
    }

    if (response.media && response.media.length > 0) {
      for (const media of response.media) {
        this.write(this.format(`[Media: ${media.path}]`, "cyan") + "\n")
      }
    }

    if (!response.isPartial) {
      this.showPrompt()
    }
  }

  override async sendStreamChunk(chunk: StreamChunk, _threadId?: string): Promise<void> {
    if (chunk.type === "text" && chunk.text) {
      if (!this.isStreaming) {
        this.isStreaming = true
        this.stopSpinner()
        this.clearLine()
      }

      this.streamBuffer += chunk.text
      this.write(chunk.text)

      if (chunk.isFinal) {
        this.write("\n")
        this.isStreaming = false
        this.streamBuffer = ""
        this.showPrompt()
      }
    } else if (chunk.type === "tool_start" && chunk.tool) {
      this.showToolStart(chunk.tool.name, chunk.tool.input)
    } else if (chunk.type === "tool_end" && chunk.tool) {
      this.showToolEnd(chunk.tool.name, chunk.tool.output, chunk.tool.error)
    } else if (chunk.type === "thinking" && chunk.text) {
      this.showThinking(chunk.text)
    } else if (chunk.type === "error" && chunk.text) {
      this.write(this.format(`Error: ${chunk.text}`, "red") + "\n")
    }
  }

  override async sendTypingIndicator(_threadId?: string): Promise<void> {
    this.startSpinner()
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

    // Show interactive prompt
    return this.showPermissionPrompt(request, resolved.timeoutMs)
  }

  private async showPermissionPrompt(request: PermissionRequest, timeoutMs: number): Promise<PermissionResponse> {
    return new Promise((resolve) => {
      const timeoutId =
        timeoutMs > 0
          ? setTimeout(() => {
              this.write("\n" + this.format("(Timed out, applying default)", "dim") + "\n")
              resolve({
                requestId: request.id,
                action: request.defaultAction,
              })
            }, timeoutMs)
          : null

      // Format the permission request
      const typeLabel = this.formatPermissionType(request.type)
      const box = this.formatBox(
        [
          `${typeLabel} Permission Request`,
          "",
          request.description,
          "",
          request.toolCall ? `Tool: ${request.toolCall.name}` : "",
          "",
          `[${this.config.keyBindings.accept}] Allow  [${this.config.keyBindings.deny}] Deny  [a] Allow for session  [d] Deny for session`,
        ].filter(Boolean),
      )

      this.write("\n" + box + "\n")
      this.write("> ")

      const handler = (line: string): void => {
        if (timeoutId) clearTimeout(timeoutId)
        this.readline?.removeListener("line", handler)

        const input = line.trim().toLowerCase()
        let action: PermissionAction
        let remember = false

        switch (input) {
          case "y":
          case "yes":
          case "allow":
            action = "allow"
            break
          case "a":
          case "allow_session":
            action = "allow_session"
            remember = true
            break
          case "d":
          case "deny_session":
            action = "deny_session"
            remember = true
            break
          case "n":
          case "no":
          case "deny":
          default:
            action = "deny"
        }

        resolve({ requestId: request.id, action, remember })
      }

      this.readline?.on("line", handler)
    })
  }

  private formatPermissionType(type: string): string {
    const labels: Record<string, string> = {
      file_read: "File Read",
      file_write: "File Write",
      file_delete: "File Delete",
      execute_command: "Command Execution",
      network_request: "Network Request",
      tool_execution: "Tool Execution",
      sensitive_data: "Sensitive Data Access",
    }
    return labels[type] || type
  }

  // ---------------------------------------------------------------------------
  // Tool Notifications
  // ---------------------------------------------------------------------------

  override async notifyToolStart(toolCall: ToolCall): Promise<void> {
    if (this.config.showToolDetails) {
      this.showToolStart(toolCall.name, toolCall.input)
    } else {
      this.startSpinner()
    }
  }

  override async notifyToolEnd(result: ToolResult): Promise<void> {
    this.stopSpinner()
    if (this.config.showToolDetails) {
      this.showToolEnd(
        "tool", // We don't have the name here, could be tracked
        result.output,
        result.error,
      )
    }
  }

  private showToolStart(name: string, input?: Record<string, unknown>): void {
    const header = this.format(`Tool: ${name}`, "cyan")
    this.write(`${header}\n`)

    if (input && this.config.showToolDetails) {
      const inputStr = JSON.stringify(input, null, 2)
        .split("\n")
        .map((line) => "  " + line)
        .join("\n")
      this.write(this.format(inputStr, "dim") + "\n")
    }
  }

  private showToolEnd(_name: string, output?: unknown, error?: string): void {
    if (error) {
      this.write(this.format(`  Error: ${error}`, "red") + "\n")
    } else if (output !== undefined && this.config.showToolDetails) {
      const outputStr = typeof output === "string" ? output : JSON.stringify(output, null, 2)
      const truncated = outputStr.length > 500 ? outputStr.slice(0, 500) + "..." : outputStr
      this.write(this.format(`  ${truncated}`, "dim") + "\n")
    }
  }

  private showThinking(text: string): void {
    const formatted = this.format(`Thinking: ${text}`, "dim")
    this.write(formatted + "\n")
  }

  // ---------------------------------------------------------------------------
  // UI Helpers
  // ---------------------------------------------------------------------------

  private showPrompt(): void {
    if (this.config.promptStyle === "none") return

    if (this.useColors && this.config.promptStyle === "full") {
      const prompt = this.format("> ", "green")
      this.write(prompt)
    } else {
      this.write("> ")
    }
  }

  private startSpinner(): void {
    if (this.spinnerInterval) return

    this.spinnerInterval = setInterval(() => {
      const frame = this.spinnerFrames[this.spinnerIndex]
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length
      const spinnerOutput = this.useColors ? this.format(frame, "cyan") : frame
      this.write(`\r${spinnerOutput} `)
    }, 80)
  }

  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval)
      this.spinnerInterval = null
      this.clearLine()
    }
  }

  private write(text: string): void {
    stdout.write(text)
  }

  private clearLine(): void {
    this.write("\r\x1b[K")
  }

  private formatResponse(text: string): string {
    if (!this.useColors) {
      // Return plain text when colors are disabled
      return text
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/`(.+?)`/g, "$1")
        .replace(/^# (.+)$/gm, "$1")
        .replace(/^## (.+)$/gm, "$1")
        .replace(/^- /gm, "  - ")
    }

    // Simple markdown-like formatting for CLI
    return text
      .replace(/\*\*(.+?)\*\*/g, this.format("$1", "bold"))
      .replace(/`(.+?)`/g, this.format("$1", "cyan"))
      .replace(/^# (.+)$/gm, this.format("$1", "bold"))
      .replace(/^## (.+)$/gm, this.format("$1", "bold"))
      .replace(/^- /gm, "  - ")
  }

  private format(text: string, style: string): string {
    if (!this.useColors) return text

    const styles: Record<string, string> = {
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      cyan: "\x1b[36m",
      reset: "\x1b[0m",
    }

    const code = styles[style] || ""
    return code ? `${code}${text}${styles.reset}` : text
  }

  private formatBox(lines: string[]): string {
    const maxLen = Math.max(...lines.map((l) => l.length))
    const top = "+" + "-".repeat(maxLen + 2) + "+"
    const bottom = top
    const formatted = lines.map((l) => `| ${l.padEnd(maxLen)} |`)
    return [top, ...formatted, bottom].join("\n")
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a CLI surface instance.
 */
export function createCLISurface(config?: Partial<CLISurfaceConfig>): CLISurface {
  return new CLISurface(config)
}
