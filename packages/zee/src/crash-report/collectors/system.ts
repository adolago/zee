/**
 * @file System Collector
 * @description Collects system information for crash reports
 */

import * as os from "os";
import { execSync } from "child_process";
import type { SystemInfo } from "../types";

/**
 * Collect system information
 */
export async function collectSystemInfo(): Promise<SystemInfo> {
  return {
    os: {
      type: os.type(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    runtime: {
      bun: getBunVersion(),
      node: process.version,
    },
    shell: getShell(),
    terminal: getTerminal(),
    environment: {
      isDocker: isDocker(),
      isWSL: isWSL(),
      isSSH: isSSH(),
      isTTY: process.stdout.isTTY ?? false,
    },
    resources: {
      memoryMB: Math.round(os.freemem() / 1024 / 1024),
      cpuCores: os.cpus().length,
      loadAverage: os.loadavg(),
    },
    git: getGitInfo(),
  };
}

function getBunVersion(): string {
  try {
    return execSync("bun --version", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function getShell(): string {
  return process.env.SHELL || process.env.ComSpec || "unknown";
}

function getTerminal(): string | undefined {
  return process.env.TERM_PROGRAM || process.env.TERMINAL || process.env.TERM;
}

function isDocker(): boolean {
  try {
    const cgroup = execSync("cat /proc/1/cgroup 2>/dev/null", { encoding: "utf-8" });
    return cgroup.includes("docker") || cgroup.includes("containerd");
  } catch {
    return false;
  }
}

function isWSL(): boolean {
  try {
    const release = os.release().toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

function isSSH(): boolean {
  return !!(process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION);
}

function getGitInfo(): SystemInfo["git"] | undefined {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { encoding: "utf-8" }).trim();
    const commit = execSync("git rev-parse --short HEAD 2>/dev/null", { encoding: "utf-8" }).trim();
    const status = execSync("git status --porcelain 2>/dev/null", { encoding: "utf-8" }).trim();

    return {
      branch,
      commit,
      dirty: status.length > 0,
    };
  } catch {
    return undefined;
  }
}
