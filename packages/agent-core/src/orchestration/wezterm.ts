/**
 * WezTerm Orchestration for Daemon
 *
 * Provides visual orchestration when a display is available.
 * Creates status panes showing daemon state, sessions, and tasks.
 *
 * Architecture:
 * - Detects X11/Wayland display availability
 * - Creates status pane at bottom showing daemon health
 * - Can spawn panes for active sessions when requested
 * - Gracefully degrades when no display is available
 */

import { exec } from "node:child_process"
import { promisify } from "node:util"
import { Log } from "../util/log"
import { Timestamp } from "../util/timestamp"
import { Bus } from "../bus"
import { LifecycleHooks } from "../hooks/lifecycle"
import { Session } from "../session"
import { Todo } from "../session/todo"

const execAsync = promisify(exec)
const log = Log.create({ service: "wezterm-orchestration" })

/**
 * Escape a string for use in a single-quoted shell argument.
 * This prevents command injection by properly handling single quotes and backslashes.
 *
 * The pattern 'str'\''str' ends the single-quoted string, adds an escaped
 * literal single quote, then starts a new single-quoted string.
 */
function shellEscapeSingleQuote(str: string): string {
  // Replace single quotes with the shell idiom: end quote, escaped quote, start quote
  return str.replace(/'/g, "'\\''")
}

/**
 * Escape a string for use in bash $'...' ANSI-C quoting.
 * This is needed for sending escape sequences to terminals.
 */
function shellEscapeAnsiC(str: string): string {
  return str
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/'/g, "\\'") // Escape single quotes
    .replace(/\n/g, "\\n") // Escape newlines
    .replace(/\r/g, "\\r") // Escape carriage returns
    .replace(/\t/g, "\\t") // Escape tabs
}

export namespace WeztermOrchestration {
  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  export interface Config {
    /** Enable WezTerm orchestration (default: true if display available) */
    enabled: boolean
    /** Layout for session panes */
    layout: "horizontal" | "vertical" | "grid"
    /** Show status pane at bottom */
    showStatusPane: boolean
    /** Status pane height as percentage */
    statusPanePercent: number
    /** Auto-refresh interval for status (ms) */
    statusRefreshInterval: number
  }

  const DEFAULT_CONFIG: Config = {
    enabled: true,
    layout: "horizontal",
    showStatusPane: true,
    statusPanePercent: 20,
    statusRefreshInterval: 5000,
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  interface DaemonStatus {
    pid: number
    port: number
    hostname: string
    uptime: number
    services: {
      persistence: boolean
      whatsapp: boolean
      matrix: boolean
    }
    sessions: {
      total: number
      withIncompleteTodos: number
    }
  }

  let config: Config = DEFAULT_CONFIG
  let statusPaneId: string | null = null
  let sessionPanes = new Map<string, string>() // sessionId -> paneId
  let statusRefreshTimer: NodeJS.Timeout | null = null
  let isInitialized = false
  let daemonStartTime = Date.now()

  // Cached daemon status
  let cachedStatus: Partial<DaemonStatus> = {}

  // -------------------------------------------------------------------------
  // Display Detection
  // -------------------------------------------------------------------------

  /**
   * Check if a graphical display is available
   */
  export async function isDisplayAvailable(): Promise<boolean> {
    // Check for X11 or Wayland display
    const display = process.env.DISPLAY
    const waylandDisplay = process.env.WAYLAND_DISPLAY

    if (!display && !waylandDisplay) {
      log.debug("No display environment variable set")
      return false
    }

    // Try to run a simple X/Wayland command to verify display works
    try {
      if (display) {
        await execAsync("xdpyinfo -display $DISPLAY >/dev/null 2>&1", { timeout: 2000 })
        return true
      }
      if (waylandDisplay) {
        // For Wayland, check if wezterm can access the display
        await execAsync("wezterm cli list --format json >/dev/null 2>&1", { timeout: 2000 })
        return true
      }
    } catch {
      log.debug("Display check failed - display may not be accessible")
    }

    return false
  }

  /**
   * Check if WezTerm CLI is available
   */
  export async function isWeztermAvailable(): Promise<boolean> {
    try {
      await execAsync("wezterm cli list --format json", { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Initialize WezTerm orchestration
   */
  export async function init(userConfig: Partial<Config> = {}): Promise<boolean> {
    config = { ...DEFAULT_CONFIG, ...userConfig }

    if (!config.enabled) {
      log.info("WezTerm orchestration disabled by configuration")
      return false
    }

    // Check if display is available
    const displayAvailable = await isDisplayAvailable()
    if (!displayAvailable) {
      log.info("No display available, WezTerm orchestration disabled")
      return false
    }

    // Check if WezTerm is available
    const weztermAvailable = await isWeztermAvailable()
    if (!weztermAvailable) {
      log.info("WezTerm CLI not available, orchestration disabled")
      return false
    }

    log.info("WezTerm orchestration initialized", {
      layout: config.layout,
      showStatusPane: config.showStatusPane,
    })

    // Subscribe to lifecycle hooks
    setupHookSubscriptions()

    isInitialized = true
    return true
  }

  /**
   * Set up status pane after daemon is ready
   */
  export async function setupStatusPane(status: DaemonStatus): Promise<void> {
    if (!isInitialized || !config.showStatusPane) return

    cachedStatus = status
    daemonStartTime = Date.now() - (status.uptime || 0)

    try {
      // Create status pane at bottom
      const { stdout } = await execAsync(`wezterm cli split-pane --bottom --percent ${config.statusPanePercent}`)
      statusPaneId = stdout.trim()

      // Set pane title
      await setPaneTitle(statusPaneId, "◈ Agent-Core Daemon Status")

      // Initial status render
      await updateStatusPane()

      // Start refresh timer
      if (config.statusRefreshInterval > 0) {
        statusRefreshTimer = setInterval(() => {
          updateStatusPane().catch((e) => log.debug("Status refresh failed", { error: String(e) }))
        }, config.statusRefreshInterval)
      }

      log.info("Status pane created", { paneId: statusPaneId })
    } catch (error) {
      log.warn("Failed to create status pane", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Shutdown WezTerm orchestration
   */
  export async function shutdown(): Promise<void> {
    if (statusRefreshTimer) {
      clearInterval(statusRefreshTimer)
      statusRefreshTimer = null
    }

    // Close all session panes
    for (const [sessionId, paneId] of sessionPanes) {
      try {
        await execAsync(`wezterm cli kill-pane --pane-id ${paneId}`)
      } catch {
        // Pane may already be closed
      }
    }
    sessionPanes.clear()

    // Close status pane
    if (statusPaneId) {
      try {
        await execAsync(`wezterm cli kill-pane --pane-id ${statusPaneId}`)
      } catch {
        // Pane may already be closed
      }
      statusPaneId = null
    }

    isInitialized = false
    log.info("WezTerm orchestration shutdown complete")
  }

  // -------------------------------------------------------------------------
  // Hook Subscriptions
  // -------------------------------------------------------------------------

  function setupHookSubscriptions(): void {
    // Subscribe to daemon ready
    Bus.subscribe(LifecycleHooks.Daemon.Ready, async (event) => {
      const status: DaemonStatus = {
        pid: event.properties.pid,
        port: event.properties.port,
        hostname: "localhost",
        uptime: 0,
        services: event.properties.services,
        sessions: {
          total: 0,
          withIncompleteTodos: event.properties.sessionsWithIncompleteTodos,
        },
      }
      await setupStatusPane(status)
    })

    // Subscribe to session events for updates
    Bus.subscribe(LifecycleHooks.SessionLifecycle.Start, async () => {
      await updateStatusPane()
    })

    Bus.subscribe(LifecycleHooks.SessionLifecycle.Restore, async () => {
      await updateStatusPane()
    })

    // Subscribe to todo events
    Bus.subscribe(LifecycleHooks.TodoLifecycle.Continuation, async () => {
      await updateStatusPane()
    })

    Bus.subscribe(LifecycleHooks.TodoLifecycle.Completed, async () => {
      await updateStatusPane()
    })
  }

  // -------------------------------------------------------------------------
  // Status Pane Rendering
  // -------------------------------------------------------------------------

  async function updateStatusPane(): Promise<void> {
    if (!statusPaneId) return

    try {
      // Gather current stats
      let sessionCount = 0
      let sessionsWithTodos = 0

      try {
        for await (const session of Session.list()) {
          sessionCount++
          const todos = await Todo.get(session.id)
          const incomplete = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
          if (incomplete > 0) sessionsWithTodos++
        }
      } catch {
        // Session listing may not be available
      }

      const uptime = Math.floor((Date.now() - daemonStartTime) / 1000)
      const uptimeStr = formatUptime(uptime)

      const lines: string[] = []
      lines.push("\\033[2J\\033[H") // Clear screen

      // Header
      lines.push("╔════════════════════════════════════════════════════════╗")
      lines.push("║            ◆ AGENT-CORE DAEMON STATUS ◆               ║")
      lines.push("╠════════════════════════════════════════════════════════╣")

      // Daemon info
      lines.push(
        `║ PID: ${String(cachedStatus.pid || process.pid).padEnd(10)} Port: ${String(cachedStatus.port || "N/A").padEnd(8)} Uptime: ${uptimeStr.padEnd(12)}║`,
      )

      lines.push("╠════════════════════════════════════════════════════════╣")

      // Services
      const persistence = cachedStatus.services?.persistence ? "●" : "○"
      const whatsapp = cachedStatus.services?.whatsapp ? "●" : "○"
      const matrix = cachedStatus.services?.matrix ? "●" : "○"
      const wezterm = isInitialized ? "●" : "○"

      lines.push(
        `║ Services: Persistence ${persistence}  WhatsApp ${whatsapp}  Matrix ${matrix}  WezTerm ${wezterm} ║`,
      )

      lines.push("╠════════════════════════════════════════════════════════╣")

      // Sessions
      lines.push(
        `║ Sessions: ${String(sessionCount).padEnd(3)} total   ${String(sessionsWithTodos).padEnd(3)} with incomplete todos       ║`,
      )

      lines.push("╠════════════════════════════════════════════════════════╣")

      // Time
      lines.push(`║ Last Update: ${Timestamp.time().padEnd(42)}║`)

      lines.push("╚════════════════════════════════════════════════════════╝")

      // Send to pane
      const output = lines.join("\\n")
      await execAsync(`wezterm cli send-text --pane-id ${statusPaneId} --no-paste 'echo -e "${output}"'`)
      await execAsync(`wezterm cli send-text --pane-id ${statusPaneId} --no-paste '\n'`)
    } catch (error) {
      log.debug("Failed to update status pane", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // -------------------------------------------------------------------------
  // Session Pane Management
  // -------------------------------------------------------------------------

  /**
   * Create a pane for a session
   */
  export async function createSessionPane(
    sessionId: string,
    title: string,
    persona: "zee" | "stanley" | "johny",
  ): Promise<string | null> {
    if (!isInitialized) return null

    try {
      const direction = config.layout === "vertical" ? "--bottom" : "--right"
      const percent = config.layout === "grid" ? 50 : 40

      const { stdout } = await execAsync(`wezterm cli split-pane ${direction} --percent ${percent}`)
      const paneId = stdout.trim()

      // Set title with persona icon
      const icon = getPersonaIcon(persona)
      await setPaneTitle(paneId, `${icon} ${title}`)

      sessionPanes.set(sessionId, paneId)

      log.info("Created session pane", { sessionId, paneId, persona })
      return paneId
    } catch (error) {
      log.warn("Failed to create session pane", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Close a session pane
   */
  export async function closeSessionPane(sessionId: string): Promise<void> {
    const paneId = sessionPanes.get(sessionId)
    if (!paneId) return

    try {
      await execAsync(`wezterm cli kill-pane --pane-id ${paneId}`)
      sessionPanes.delete(sessionId)
      log.info("Closed session pane", { sessionId, paneId })
    } catch {
      // Pane may already be closed
      sessionPanes.delete(sessionId)
    }
  }

  /**
   * Send command to a session pane
   */
  export async function sendToSessionPane(sessionId: string, command: string): Promise<boolean> {
    const paneId = sessionPanes.get(sessionId)
    if (!paneId) return false

    try {
      const escapedCommand = shellEscapeSingleQuote(command)
      await execAsync(`wezterm cli send-text --pane-id ${paneId} --no-paste '${escapedCommand}\n'`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Focus a session pane
   */
  export async function focusSessionPane(sessionId: string): Promise<boolean> {
    const paneId = sessionPanes.get(sessionId)
    if (!paneId) return false

    try {
      await execAsync(`wezterm cli activate-pane --pane-id ${paneId}`)
      return true
    } catch {
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function setPaneTitle(paneId: string, title: string): Promise<void> {
    // Escape the title for ANSI-C quoting to prevent command injection
    const escapedTitle = shellEscapeAnsiC(title)
    const escapeSequence = `\\033]0;${escapedTitle}\\007`
    await execAsync(`wezterm cli send-text --pane-id ${paneId} --no-paste $'${escapeSequence}'`)
  }

  function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${mins}m`
  }

  function getPersonaIcon(persona: "zee" | "stanley" | "johny"): string {
    switch (persona) {
      case "zee":
        return "★"
      case "stanley":
        return "♦"
      case "johny":
        return "◎"
    }
  }

  // -------------------------------------------------------------------------
  // Status Queries
  // -------------------------------------------------------------------------

  export function getStatus(): {
    initialized: boolean
    statusPaneId: string | null
    sessionPaneCount: number
    displayAvailable: boolean
  } {
    return {
      initialized: isInitialized,
      statusPaneId,
      sessionPaneCount: sessionPanes.size,
      displayAvailable: !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY,
    }
  }

  /**
   * Update cached daemon status (called from daemon)
   */
  export function updateDaemonStatus(status: Partial<DaemonStatus>): void {
    cachedStatus = { ...cachedStatus, ...status }
  }
}
