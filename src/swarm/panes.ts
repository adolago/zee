/**
 * WezTerm Pane Management
 * Visual orchestration - each worker gets its own pane
 */

import { spawn } from "child_process";

export interface PaneConfig {
  title: string;
  cwd?: string;
  command?: string[];
}

export interface PaneHandle {
  paneId: string;
  close: () => Promise<void>;
  send: (text: string) => Promise<void>;
}

/**
 * Check if WezTerm CLI is available
 */
export async function isWezTermAvailable(): Promise<boolean> {
  try {
    const proc = spawn("wezterm", ["cli", "list"], { stdio: "pipe" });
    return new Promise((resolve) => {
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}

/**
 * Split current pane and run command
 */
export async function splitPane(config: PaneConfig): Promise<PaneHandle | null> {
  if (!(await isWezTermAvailable())) {
    return null;
  }

  const args = ["cli", "split-pane", "--horizontal"];
  
  if (config.cwd) {
    args.push("--cwd", config.cwd);
  }

  if (config.command && config.command.length > 0) {
    args.push("--", ...config.command);
  }

  return new Promise((resolve) => {
    const proc = spawn("wezterm", args, { stdio: "pipe" });
    let paneId = "";

    proc.stdout.on("data", (data) => {
      paneId = data.toString().trim();
    });

    proc.on("close", (code) => {
      if (code === 0 && paneId) {
        resolve({
          paneId,
          close: () => closePane(paneId),
          send: (text) => sendToPane(paneId, text),
        });
      } else {
        resolve(null);
      }
    });

    proc.on("error", () => resolve(null));
  });
}

/**
 * Close a pane by ID
 */
async function closePane(paneId: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn("wezterm", ["cli", "kill-pane", "--pane-id", paneId], {
      stdio: "ignore",
    });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}

/**
 * Send text to a pane
 */
async function sendToPane(paneId: string, text: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn("wezterm", ["cli", "send-text", "--pane-id", paneId, "--no-paste"], {
      stdio: "pipe",
    });
    proc.stdin.write(text);
    proc.stdin.end();
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}

/**
 * Create a grid of panes for N workers
 */
export async function createWorkerPanes(
  count: number,
  baseCwd?: string
): Promise<Map<number, PaneHandle>> {
  const panes = new Map<number, PaneHandle>();

  if (!(await isWezTermAvailable())) {
    return panes;
  }

  for (let i = 0; i < count; i++) {
    const handle = await splitPane({
      title: `Worker ${i + 1}`,
      cwd: baseCwd,
    });
    if (handle) {
      panes.set(i, handle);
    }
  }

  return panes;
}

/**
 * Close all worker panes
 */
export async function closeAllPanes(panes: Map<number, PaneHandle>): Promise<void> {
  const promises = Array.from(panes.values()).map((p) => p.close());
  await Promise.all(promises);
}
