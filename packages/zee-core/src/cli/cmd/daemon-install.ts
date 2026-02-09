/**
 * Daemon Install Wizard
 *
 * Installs zee daemon as a user systemd service (Linux only).
 * Zee daemon is the primary service - it can optionally spawn the Zee gateway
 * as a child process via the --gateway flag.
 *
 * IMPORTANT: This does NOT install zee gateway separately. Zee gateway runs
 * as a child process of zee daemon when --gateway is enabled.
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as prompts from "@clack/prompts";
import { cmd } from "./cmd";
import { Global } from "../../global";
import { Log } from "../../util/log";
import { UI } from "../ui";

const log = Log.create({ service: "daemon-install" });

// =============================================================================
// Constants
// =============================================================================

const SERVICE_DESCRIPTION = "Zee Daemon - AI Assistant Platform";

// Linux systemd user service
const SYSTEMD_UNIT_NAME = "zee.service";
const SYSTEMD_UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user");
const SYSTEMD_UNIT_PATH = path.join(SYSTEMD_UNIT_DIR, SYSTEMD_UNIT_NAME);

// Log paths
const LOG_DIR = path.join(Global.Path.state, "logs");
const STDOUT_LOG = path.join(LOG_DIR, "daemon.log");
const STDERR_LOG = path.join(LOG_DIR, "daemon.err.log");

// =============================================================================
// Types
// =============================================================================

export interface DaemonInstallOptions {
  port?: number;
  hostname?: string;
  gateway?: boolean;
  gatewayForce?: boolean;
  wezterm?: boolean;
  workingDirectory?: string;
  force?: boolean;
  nonInteractive?: boolean;
}

export interface DaemonInstallResult {
  success: boolean;
  platform: "linux" | "unsupported";
  servicePath?: string;
  error?: string;
  hints?: string[];
}

// =============================================================================
// Platform Detection
// =============================================================================

function getPlatform(): "linux" | "unsupported" {
  return os.platform() === "linux" ? "linux" : "unsupported";
}

function hasSystemd(): boolean {
  try {
    const result = spawnSync("systemctl", ["--user", "--version"], {
      stdio: "pipe",
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// =============================================================================
// Binary Resolution
// =============================================================================

function resolveZeeBinary(): string | null {
  // Check common locations
  const candidates = [
    // Bun global install
    path.join(os.homedir(), ".bun", "bin", "zee"),
    path.join(os.homedir(), ".bun", "bin", "agent-core"),
    // User local bin
    path.join(os.homedir(), "bin", "zee"),
    path.join(os.homedir(), "bin", "agent-core"),
    path.join(os.homedir(), ".local", "bin", "zee"),
    path.join(os.homedir(), ".local", "bin", "agent-core"),
    // npm global
    "/usr/local/bin/zee",
    "/usr/local/bin/agent-core",
    // Current process (if running from zee)
    process.argv[1]?.includes("zee") ? process.argv[0] : null,
    // Legacy alias (agent-core)
    process.argv[1]?.includes("agent-core") ? process.argv[0] : null,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        // Verify it's executable
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      continue;
    }
  }

  // Try to find via which
  try {
    const result = spawnSync("which", ["zee"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch {
    // Ignore
  }

  // Legacy fallback: agent-core
  try {
    const result = spawnSync("which", ["agent-core"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch {
    // Ignore
  }

  return null;
}

function resolveNodeBinary(): string {
  // Try bun first (preferred)
  try {
    const bunPath = spawnSync("which", ["bun"], { encoding: "utf-8", timeout: 5000 });
    if (bunPath.status === 0 && bunPath.stdout.trim()) {
      return bunPath.stdout.trim();
    }
  } catch {
    // Ignore
  }

  // Fall back to node
  try {
    const nodePath = spawnSync("which", ["node"], { encoding: "utf-8", timeout: 5000 });
    if (nodePath.status === 0 && nodePath.stdout.trim()) {
      return nodePath.stdout.trim();
    }
  } catch {
    // Ignore
  }

  return "/usr/bin/node";
}

// =============================================================================
// Environment Building
// =============================================================================

function buildServiceEnv(options: DaemonInstallOptions): Record<string, string> {
  const env: Record<string, string> = {
    HOME: os.homedir(),
    PATH: buildServicePath(),
    NODE_ENV: "production",
    ZEE_HEADLESS: "1",
    // Backward compat for any callers that still read legacy env vars.
    AGENT_CORE_HEADLESS: "1",
  };

  if (options.port) {
    env.ZEE_PORT = String(options.port);
    env.AGENT_CORE_PORT = String(options.port);
  }

  if (options.hostname) {
    env.ZEE_HOSTNAME = options.hostname;
    env.AGENT_CORE_HOSTNAME = options.hostname;
  }

  return env;
}

function buildServicePath(): string {
  const home = os.homedir();
  const pathParts: string[] = [];

  // User binary directories (version managers, package managers)
  const userBinDirs = [
    path.join(home, ".bun", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".cargo", "bin"),
    // pnpm
    process.env.PNPM_HOME,
    path.join(home, ".local", "share", "pnpm"),
    // nvm
    process.env.NVM_BIN,
    // fnm
    process.env.FNM_MULTISHELL_PATH,
    // volta
    path.join(home, ".volta", "bin"),
    // asdf
    path.join(home, ".asdf", "shims"),
  ].filter(Boolean) as string[];

  for (const dir of userBinDirs) {
    if (fs.existsSync(dir)) {
      pathParts.push(dir);
    }
  }

  // System paths
  pathParts.push("/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");

  return pathParts.join(":");
}

// =============================================================================
// Linux systemd
// =============================================================================

function generateSystemdUnit(
  binaryPath: string,
  options: DaemonInstallOptions
): string {
  const args = ["daemon"];

  if (options.port) args.push("--port", String(options.port));
  if (options.hostname) args.push("--hostname", options.hostname);
  if (options.gateway) args.push("--gateway");
  if (options.gatewayForce) args.push("--gateway-force");
  if (options.wezterm === false) args.push("--no-wezterm");
  if (options.workingDirectory) args.push("--directory", options.workingDirectory);

  const execStart = [binaryPath, ...args].join(" ");
  const workDir = options.workingDirectory ?? os.homedir();
  const env = buildServiceEnv(options);
  const envLines = Object.entries(env)
    .map(([k, v]) => `Environment="${k}=${v}"`)
    .join("\n");

  return `[Unit]
Description=${SERVICE_DESCRIPTION}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${workDir}
Restart=always
RestartSec=5
RestartPreventExitStatus=100
SuccessExitStatus=100
KillMode=process

# Environment
${envLines}

# Logging
StandardOutput=append:${STDOUT_LOG}
StandardError=append:${STDERR_LOG}

[Install]
WantedBy=default.target
`;
}

async function ensureSystemdLinger(interactive: boolean): Promise<boolean> {
  const user = os.userInfo().username;
  const lingerPath = `/var/lib/systemd/linger/${user}`;

  // Check if already enabled
  if (fs.existsSync(lingerPath)) {
    return true;
  }

  if (interactive) {
    const confirm = await prompts.confirm({
      message: `Enable systemd linger for user '${user}'? (Required for service to run after logout)`,
      initialValue: true,
    });

    if (prompts.isCancel(confirm) || !confirm) {
      return false;
    }
  }

  // Try to enable linger
  try {
    const result = spawnSync("loginctl", ["enable-linger", user], {
      stdio: "pipe",
      timeout: 30000,
    });
    if (result.status === 0) {
      return true;
    }

    // May need sudo
    if (interactive) {
      UI.warn("Linger requires sudo. You may be prompted for your password.");
    }
    const sudoResult = spawnSync("sudo", ["loginctl", "enable-linger", user], {
      stdio: "inherit",
      timeout: 60000,
    });
    return sudoResult.status === 0;
  } catch {
    return false;
  }
}

async function installSystemdService(
  binaryPath: string,
  options: DaemonInstallOptions
): Promise<DaemonInstallResult> {
  const hints: string[] = [];

  // Check systemd availability
  if (!hasSystemd()) {
    return {
      success: false,
      platform: "linux",
      error: "systemd user services not available. Is systemd running?",
    };
  }

  // Create directories
  try {
    fs.mkdirSync(SYSTEMD_UNIT_DIR, { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    return {
      success: false,
      platform: "linux",
      error: `Failed to create directories: ${err}`,
    };
  }

  // Ensure linger is enabled
  const lingerEnabled = await ensureSystemdLinger(!options.nonInteractive);
  if (!lingerEnabled) {
    hints.push("Warning: systemd linger not enabled. Service may stop when you log out.");
    hints.push("Enable with: sudo loginctl enable-linger $USER");
  }

  // Stop existing service if running
  try {
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    });
  } catch {
    // Ignore if not running
  }

  // Generate and write unit file
  const unit = generateSystemdUnit(binaryPath, options);
  try {
    fs.writeFileSync(SYSTEMD_UNIT_PATH, unit, { mode: 0o644 });
    log.info("wrote systemd unit", { path: SYSTEMD_UNIT_PATH });
  } catch (err) {
    return {
      success: false,
      platform: "linux",
      error: `Failed to write unit file: ${err}`,
    };
  }

  // Reload systemd
  try {
    const result = spawnSync("systemctl", ["--user", "daemon-reload"], {
      stdio: "pipe",
      timeout: 10000,
    });
    if (result.status !== 0) {
      return {
        success: false,
        platform: "linux",
        servicePath: SYSTEMD_UNIT_PATH,
        error: `systemctl daemon-reload failed: ${result.stderr?.toString()}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      platform: "linux",
      servicePath: SYSTEMD_UNIT_PATH,
      error: `Failed to reload systemd: ${err}`,
    };
  }

  // Enable and start service
  try {
    spawnSync("systemctl", ["--user", "enable", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    });
    const startResult = spawnSync("systemctl", ["--user", "start", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    });
    if (startResult.status !== 0) {
      hints.push(`Service may need manual start: systemctl --user start ${SYSTEMD_UNIT_NAME}`);
    }
  } catch {
    hints.push(`Service may need manual start: systemctl --user start ${SYSTEMD_UNIT_NAME}`);
  }

  hints.push(`Logs: journalctl --user -u ${SYSTEMD_UNIT_NAME} -f`);
  hints.push(`Or: ${STDOUT_LOG}`);
  hints.push(`Stop: systemctl --user stop ${SYSTEMD_UNIT_NAME}`);
  hints.push(`Restart: systemctl --user restart ${SYSTEMD_UNIT_NAME}`);
  hints.push(`Status: systemctl --user status ${SYSTEMD_UNIT_NAME}`);

  return {
    success: true,
    platform: "linux",
    servicePath: SYSTEMD_UNIT_PATH,
    hints,
  };
}

async function uninstallSystemdService(): Promise<DaemonInstallResult> {
  try {
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    });
    spawnSync("systemctl", ["--user", "disable", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    });
  } catch {
    // Ignore if not running
  }

  try {
    if (fs.existsSync(SYSTEMD_UNIT_PATH)) {
      fs.unlinkSync(SYSTEMD_UNIT_PATH);
    }
    spawnSync("systemctl", ["--user", "daemon-reload"], {
      stdio: "pipe",
      timeout: 10000,
    });
  } catch (err) {
    return {
      success: false,
      platform: "linux",
      error: `Failed to remove unit file: ${err}`,
    };
  }

  return {
    success: true,
    platform: "linux",
    hints: ["systemd service removed successfully"],
  };
}

// =============================================================================
// Main Install/Uninstall Functions
// =============================================================================

export async function installDaemon(
  options: DaemonInstallOptions = {}
): Promise<DaemonInstallResult> {
  const platform = getPlatform();

  if (platform === "unsupported") {
    return {
      success: false,
      platform: "unsupported",
      error: `Platform '${os.platform()}' is not supported. Only Linux is supported.`,
    };
  }

  // Find zee binary
  const binaryPath = resolveZeeBinary();
  if (!binaryPath) {
    return {
      success: false,
      platform,
      error: "Could not find zee binary. Ensure it's installed and in PATH.",
      hints: [
        "Install with: bun install -g @zee/core",
        "Or: npm install -g @zee/core",
      ],
    };
  }

  log.info("resolved binary", { path: binaryPath });

  // Check if already installed (unless force)
  if (!options.force) {
    const existingPath = SYSTEMD_UNIT_PATH;
    if (fs.existsSync(existingPath)) {
      return {
        success: true,
        platform,
        servicePath: existingPath,
        hints: ["Service already installed. Use --force to reinstall."],
      };
    }
  }

  return installSystemdService(binaryPath, options);
}

export async function uninstallDaemon(): Promise<DaemonInstallResult> {
  const platform = getPlatform();

  if (platform === "unsupported") {
    return {
      success: false,
      platform: "unsupported",
      error: `Platform '${os.platform()}' is not supported.`,
    };
  }

  return uninstallSystemdService();
}

export function getDaemonServiceStatus(): {
  installed: boolean;
  running: boolean;
  platform: string;
  servicePath?: string;
} {
  const platform = getPlatform();

  if (platform === "unsupported") {
    return { installed: false, running: false, platform: os.platform() };
  }

  const servicePath = SYSTEMD_UNIT_PATH;
  const installed = fs.existsSync(servicePath);

  let running = false;
  if (installed) {
    try {
      const result = spawnSync(
        "systemctl",
        ["--user", "is-active", SYSTEMD_UNIT_NAME],
        { stdio: "pipe", timeout: 5000 }
      );
      running = result.stdout?.toString().trim() === "active";
    } catch {
      running = false;
    }
  }

  return { installed, running, platform, servicePath };
}

// =============================================================================
// CLI Commands
// =============================================================================

export const DaemonInstallCommand = cmd({
  command: "daemon-install",
  describe: "Install zee daemon as a user systemd service (Linux)",
  builder: (yargs) =>
    yargs
      .option("port", {
        describe: "Daemon port",
        type: "number",
        default: 3210,
      })
      .option("hostname", {
        describe: "Daemon hostname",
        type: "string",
        default: "127.0.0.1",
      })
      .option("gateway", {
        describe: "Enable zee messaging gateway",
        type: "boolean",
        default: false,
      })
      .option("gateway-force", {
        describe: "Force gateway start even if preflight fails",
        type: "boolean",
        default: false,
      })
      .option("wezterm", {
        describe: "Enable WezTerm visual orchestration",
        type: "boolean",
        default: true,
      })
      .option("directory", {
        describe: "Working directory for daemon",
        type: "string",
      })
      .option("force", {
        describe: "Force reinstall if already installed",
        type: "boolean",
        default: false,
      })
      .option("non-interactive", {
        describe: "Run without prompts",
        type: "boolean",
        default: false,
      })
      .option("json", {
        describe: "Output as JSON",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const options: DaemonInstallOptions = {
      port: args.port as number,
      hostname: args.hostname as string,
      gateway: args.gateway as boolean,
      gatewayForce: args["gateway-force"] as boolean,
      wezterm: args.wezterm as boolean,
      workingDirectory: args.directory as string | undefined,
      force: args.force as boolean,
      nonInteractive: args["non-interactive"] as boolean,
    };

    // Interactive wizard (unless non-interactive)
    if (!options.nonInteractive && !args.json) {
      prompts.intro("Zee Daemon Install Wizard");

      const platform = getPlatform();
      if (platform === "unsupported") {
        prompts.cancel(`Platform '${os.platform()}' is not supported.`);
        process.exit(1);
      }

      prompts.log.info("Platform: Linux (systemd)");

      // Check existing installation
      const status = getDaemonServiceStatus();
      if (status.installed && !options.force) {
        const reinstall = await prompts.confirm({
          message: `Service already installed at ${status.servicePath}. Reinstall?`,
          initialValue: false,
        });
        if (prompts.isCancel(reinstall) || !reinstall) {
          prompts.outro("Installation cancelled.");
          process.exit(0);
        }
        options.force = true;
      }

      // Confirm gateway option
      if (!options.gateway) {
        const enableGateway = await prompts.confirm({
          message: "Enable zee messaging gateway (WhatsApp/Matrix)?",
          initialValue: false,
        });
        if (!prompts.isCancel(enableGateway)) {
          options.gateway = enableGateway;
        }
      }

      prompts.log.step("Installing service...");
    }

    const result = await installDaemon(options);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.success) {
      UI.success("Zee daemon installed successfully!");
      console.log(`\nService: ${result.servicePath}`);
      if (result.hints?.length) {
        console.log("\nUseful commands:");
        for (const hint of result.hints) {
          console.log(`  ${hint}`);
        }
      }
    } else {
      UI.error(`Installation failed: ${result.error}`);
      if (result.hints?.length) {
        console.log("\nHints:");
        for (const hint of result.hints) {
          console.log(`  ${hint}`);
        }
      }
      process.exit(1);
    }
  },
});

export const DaemonUninstallCommand = cmd({
  command: "daemon-uninstall",
  describe: "Uninstall zee daemon service",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "Output as JSON",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    const result = await uninstallDaemon();

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.success) {
      UI.success("Zee daemon service removed.");
      if (result.hints?.length) {
        for (const hint of result.hints) {
          console.log(`  ${hint}`);
        }
      }
    } else {
      UI.error(`Uninstall failed: ${result.error}`);
      process.exit(1);
    }
  },
});

export const DaemonServiceStatusCommand = cmd({
  command: "daemon-service-status",
  describe: "Check zee daemon service status",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "Output as JSON",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    const status = getDaemonServiceStatus();

    if (args.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log("Zee Daemon Service Status");
      console.log(`  Platform:  ${status.platform}`);
      console.log(`  Installed: ${status.installed ? "yes" : "no"}`);
      if (status.installed) {
        console.log(`  Running:   ${status.running ? "yes" : "no"}`);
        console.log(`  Service:   ${status.servicePath}`);
      }
    }
  },
});
