/**
 * WezTerm Integration
 *
 * Manages WezTerm panes for the Personas system.
 * Creates and controls panes for queens and drones.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Log } from "../../packages/zee/src/util/log";
import type {
  Worker,
  PersonasState,
  PersonasConfig,
  WeztermBridge,
  PersonaId,
} from "./types";
import { getPersonaConfig } from "./persona";
import {
  escapeShellArg,
  escapeDoubleQuoted,
  stripControlChars,
  validatePersona,
} from "../util/shell-escape";

const execAsync = promisify(exec);
const log = Log.create({ service: "personas-wezterm" });

/**
 * WezTerm CLI-based pane management
 */
export class WeztermPaneBridge implements WeztermBridge {
  private config: PersonasConfig["wezterm"];
  private statusPaneId?: string;
  private paneMap = new Map<string, string>(); // workerId -> paneId

  constructor(config: PersonasConfig["wezterm"]) {
    this.config = config;
  }

  /**
   * Check if WezTerm CLI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync("wezterm cli list --format json");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current pane ID
   */
  async getCurrentPaneId(): Promise<string> {
    const { stdout } = await execAsync("wezterm cli list --format json");
    const panes = JSON.parse(stdout);
    // Find the focused pane
    const focused = panes.find((p: { is_active: boolean }) => p.is_active);
    return focused?.pane_id?.toString() ?? panes[0]?.pane_id?.toString() ?? "0";
  }

  /**
   * Create a new pane for a worker
   */
  async createWorkerPane(worker: Worker): Promise<string> {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error("WezTerm CLI not available");
    }

    const persona = getPersonaConfig(worker.persona);
    const direction = this.config.layout === "vertical" ? "--bottom" : "--right";
    const percent = this.config.layout === "grid" ? 50 : 30;

    // Split the current pane
    const { stdout } = await execAsync(
      `wezterm cli split-pane ${direction} --percent ${percent}`
    );
    const paneId = stdout.trim();

    // Set the pane title
    await this.setPaneTitle(paneId, `${persona.icon} ${worker.role === "queen" ? persona.displayName : `${persona.displayName} Drone`}`);

    // Store mapping
    this.paneMap.set(worker.id, paneId);

    return paneId;
  }

  /**
   * Close a pane
   */
  async closePane(paneId: string): Promise<void> {
    try {
      await execAsync(`wezterm cli kill-pane --pane-id ${paneId}`);
    } catch {
      // Pane might already be closed
    }

    // Remove from map
    const entries = Array.from(this.paneMap.entries());
    for (const [workerId, pid] of entries) {
      if (pid === paneId) {
        this.paneMap.delete(workerId);
        break;
      }
    }
  }

  /**
   * Send a command to a pane
   */
  async sendCommand(paneId: string, command: string): Promise<void> {
    // Validate pane ID is numeric
    if (!/^\d+$/.test(paneId)) {
      throw new Error(`Invalid pane ID: ${paneId}`);
    }
    // Strip any control characters from command and escape for shell
    const sanitized = stripControlChars(command);
    const escaped = escapeShellArg(sanitized);
    await execAsync(`wezterm cli send-text --pane-id ${paneId} --no-paste '${escaped}\n'`);
  }

  /**
   * Get pane output (note: WezTerm CLI has limited support for this)
   */
  async getOutput(paneId: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `wezterm cli get-text --pane-id ${paneId}`
      );
      return stdout;
    } catch {
      return "";
    }
  }

  /**
   * Set pane title
   */
  async setPaneTitle(paneId: string, title: string): Promise<void> {
    // Validate pane ID is numeric
    if (!/^\d+$/.test(paneId)) {
      throw new Error(`Invalid pane ID: ${paneId}`);
    }
    // Sanitize title to prevent escape sequence injection
    const sanitizedTitle = stripControlChars(title);
    const escapedTitle = escapeShellArg(sanitizedTitle);
    // WezTerm uses OSC escape sequence for titles: ESC ] 0 ; title BEL
    const escapeSequence = `\\033]0;${escapedTitle}\\007`;
    await execAsync(
      `wezterm cli send-text --pane-id ${paneId} --no-paste $'${escapeSequence}'`
    );
  }

  /**
   * Focus a pane
   */
  async focusPane(paneId: string): Promise<void> {
    await execAsync(`wezterm cli activate-pane --pane-id ${paneId}`);
  }

  /**
   * List all panes
   */
  async listPanes(): Promise<Array<{ id: string; title: string }>> {
    try {
      const { stdout } = await execAsync("wezterm cli list --format json");
      const panes = JSON.parse(stdout);
      return panes.map((p: { pane_id: number; title: string }) => ({
        id: p.pane_id.toString(),
        title: p.title ?? "",
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get current pane layout info
   */
  async getLayout(): Promise<string> {
    try {
      const { stdout } = await execAsync("wezterm cli list --format json");
      return stdout;
    } catch {
      return "{}";
    }
  }

  /**
   * Set up the personas layout with status pane
   */
  async setupLayout(config: PersonasConfig["wezterm"]): Promise<void> {
    this.config = config;

    if (!config.showStatusPane) return;

    const available = await this.isAvailable();
    if (!available) {
      log.warn("WezTerm CLI not available, skipping layout setup");
      return;
    }

    // Create status pane at bottom
    const { stdout } = await execAsync(
      "wezterm cli split-pane --bottom --percent 20"
    );
    this.statusPaneId = stdout.trim();

    // Set title
    await this.setPaneTitle(this.statusPaneId, "◈ Personas Status");

    // Initialize status display
    await this.sendCommand(this.statusPaneId, "clear");
    await this.sendCommand(this.statusPaneId, "echo '=== Personas Status ==='");
  }

  /**
   * Update the status pane with current state
   */
  async updateStatus(state: PersonasState): Promise<void> {
    if (!this.statusPaneId) return;

    const lines: string[] = [];
    // Use printf for controlled escape sequence interpretation
    // Clear screen and move cursor to top
    lines.push("\x1b[2J\x1b[H");
    lines.push("╔══════════════════════════════════════════╗");
    lines.push("║           ◆ PERSONAS STATUS ◆            ║");
    lines.push("╠══════════════════════════════════════════╣");

    // Workers by persona
    const workersByPersona = state.workers.reduce(
      (acc, w) => {
        if (!acc[w.persona]) acc[w.persona] = [];
        acc[w.persona].push(w);
        return acc;
      },
      {} as Record<string, Worker[]>
    );

    for (const [persona, workers] of Object.entries(workersByPersona)) {
      const config = getPersonaConfig(persona as PersonaId);
      const queens = workers.filter((w) => w.role === "queen");
      const drones = workers.filter((w) => w.role === "drone");
      // Sanitize displayName to prevent injection
      const safeName = stripControlChars(config.displayName).padEnd(8);
      const safeIcon = stripControlChars(config.icon);
      lines.push(
        `║ ${safeIcon} ${safeName} Q:${queens.length} D:${drones.length} ${this.getStatusIndicator(workers)}`.padEnd(43) + "║"
      );
    }

    lines.push("╠══════════════════════════════════════════╣");

    // Tasks
    const pendingTasks = state.tasks.filter((t) => t.status === "pending").length;
    const runningTasks = state.tasks.filter((t) => t.status === "running").length;
    const completedTasks = state.stats.totalTasksCompleted;

    lines.push(`║ Tasks: ◐${pendingTasks} ⟳${runningTasks} ✔${completedTasks}`.padEnd(43) + "║");

    // Conversation
    if (state.conversation) {
      const lead = getPersonaConfig(state.conversation.leadPersona);
      const leadIndicator = this.colorize("●", lead.color);
      const safeLeadName = stripControlChars(lead.displayName);
      const safeLeadIcon = stripControlChars(lead.icon);
      lines.push(`║ Presence: ${leadIndicator} ${safeLeadName} (Queen)`.padEnd(43) + "║");
      lines.push(`║ Lead: ${safeLeadIcon} ${safeLeadName}`.padEnd(43) + "║");
      if (state.conversation.objectives.length > 0) {
        lines.push(`║ Goals: ${state.conversation.objectives.length} active`.padEnd(43) + "║");
      }
    }

    lines.push("╠══════════════════════════════════════════╣");
    lines.push(`║ Last sync: ${new Date(state.lastSyncAt).toLocaleTimeString()}`.padEnd(43) + "║");
    lines.push("╚══════════════════════════════════════════╝");

    // Send to status pane using printf for controlled escape handling
    // printf interprets escapes, but the content is sanitized
    const output = lines.join("\n");
    const escaped = escapeShellArg(output);
    await execAsync(`wezterm cli send-text --pane-id ${this.statusPaneId} --no-paste '${escaped}'`);
  }

  /**
   * Get status indicator for workers
   */
  private getStatusIndicator(workers: Worker[]): string {
    const hasWorking = workers.some((w) => w.status === "working");
    const hasError = workers.some((w) => w.status === "error");
    const hasIdle = workers.some((w) => w.status === "idle");

    if (hasError) return "●"; // red context
    if (hasWorking) return "●"; // green context
    if (hasIdle) return "●"; // yellow context
    return "○";
  }

  private colorize(text: string, hex: string): string {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return text;
    const { r, g, b } = rgb;
    return `\\033[38;2;${r};${g};${b}m${text}\\033[0m`;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const normalized = hex.replace("#", "");
    if (normalized.length !== 6) return null;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }

  /**
   * Launch Claude Code in a pane
   */
  async launchClaudeCode(
    paneId: string,
    options: {
      workingDir?: string;
      prompt?: string;
      persona?: PersonaId;
    }
  ): Promise<void> {
    const commands: string[] = [];

    // Change directory if specified
    if (options.workingDir) {
      // Escape the path for double-quoted shell argument
      const escapedPath = escapeDoubleQuoted(options.workingDir);
      commands.push(`cd "${escapedPath}"`);
    }

    // Build zee command
    let agentCmd = "zee";
    if (options.prompt) {
      // Escape prompt for double-quoted shell argument
      const escapedPrompt = escapeDoubleQuoted(options.prompt);
      // Validate persona against whitelist to prevent injection
      const validPersona = validatePersona(options.persona);
      const personaArg = validPersona ? `--agent ${validPersona}` : "";
      agentCmd = `zee run "${escapedPrompt}" ${personaArg}`;
    }

    commands.push(agentCmd);

    // Send commands
    for (const cmd of commands) {
      await this.sendCommand(paneId, cmd);
    }
  }

  /**
   * Close all personas panes
   */
  async closeAllPanes(): Promise<void> {
    const paneIds = Array.from(this.paneMap.values());
    for (const paneId of paneIds) {
      await this.closePane(paneId);
    }

    if (this.statusPaneId) {
      await this.closePane(this.statusPaneId);
      this.statusPaneId = undefined;
    }
  }

  /**
   * Get pane ID for a worker
   */
  getPaneForWorker(workerId: string): string | undefined {
    return this.paneMap.get(workerId);
  }
}

/**
 * Create a WezTerm bridge with default configuration
 */
export function createWeztermBridge(
  config?: Partial<PersonasConfig["wezterm"]>
): WeztermPaneBridge {
  const fullConfig: PersonasConfig["wezterm"] = {
    enabled: config?.enabled ?? true,
    layout: config?.layout ?? "horizontal",
    showStatusPane: config?.showStatusPane ?? true,
  };

  return new WeztermPaneBridge(fullConfig);
}
