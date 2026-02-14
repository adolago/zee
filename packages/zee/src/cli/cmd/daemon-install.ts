/**
 * Daemon Install Wizard
 *
 * Installs zee daemon as a user systemd service (Linux only).
 * Zee daemon is the primary service and always embeds the Zee gateway.
 *
 * IMPORTANT: This does NOT install zee gateway separately. Zee gateway runs as a child process of zee daemon.
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
const SYSTEMD_ORCH_UNIT_NAME = "zee-orch.service";
const SYSTEMD_UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user");
const SYSTEMD_UNIT_PATH = path.join(SYSTEMD_UNIT_DIR, SYSTEMD_UNIT_NAME);
const SYSTEMD_ORCH_UNIT_PATH = path.join(SYSTEMD_UNIT_DIR, SYSTEMD_ORCH_UNIT_NAME);

// Log paths
const LOG_DIR = path.join(Global.Path.state, "logs");
const STDOUT_LOG = path.join(LOG_DIR, "daemon.log");
const STDERR_LOG = path.join(LOG_DIR, "daemon.err.log");
const ORCH_STDOUT_LOG = path.join(LOG_DIR, "daemon-orch.log");
const ORCH_STDERR_LOG = path.join(LOG_DIR, "daemon-orch.err.log");

// =============================================================================
// Types
// =============================================================================

export interface DaemonInstallOptions {
  port?: number;
  hostname?: string;
  gateway?: boolean;
  gatewayForce?: boolean;
  wezterm?: boolean;
  orchestration?: boolean;
  orchSocketPath?: string;
  orchMaxWorkers?: number;
  orchQueueCap?: number;
  orchQueueDropPolicy?: "old" | "new" | "summarize";
  orchQueueDedupeMode?: "task-id" | "prompt" | "none";
  workingDirectory?: string;
  force?: boolean;
  nonInteractive?: boolean;
}

export interface DaemonInstallResult {
  success: boolean;
  platform: "linux" | "unsupported";
  servicePath?: string;
  orchestrationServicePath?: string;
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
  const isExecutableZeeBinary = (candidate: string): boolean => {
    const base = path.basename(candidate).toLowerCase();
    if (base !== "zee" && base !== "zee.exe") return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  };

  // Check common locations
  const candidates = [
    // Bun global install
    path.join(os.homedir(), ".bun", "bin", "zee"),
    // User local bin
    path.join(os.homedir(), "bin", "zee"),
    path.join(os.homedir(), ".local", "bin", "zee"),
    // npm global
    "/usr/local/bin/zee",
    // Current process (if running from zee)
    path.basename(process.argv[0] ?? "").toLowerCase() === "zee" ? process.argv[0] : null,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && isExecutableZeeBinary(candidate)) {
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
    if (result.status === 0 && result.stdout.trim() && isExecutableZeeBinary(result.stdout.trim())) {
      return result.stdout.trim();
    }
  } catch {
    // Ignore
  }

  return null;
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
  };

  if (options.port) {
    env.ZEE_PORT = String(options.port);
  }

  if (options.hostname) {
    env.ZEE_HOSTNAME = options.hostname;
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

function resolveStateHome(): string {
  const home = os.homedir();
  return process.env.XDG_STATE_HOME || path.join(home, ".local", "state");
}

function resolveDefaultOrchSocketPath(): string {
  return path.join(resolveStateHome(), "zee", "daemon", "daemon.sock");
}

function resolveLegacyOrchSocketPath(): string {
  return path.join(resolveStateHome(), "zee", "daemon.sock");
}

function resolveOrchSocketPath(options: DaemonInstallOptions): string {
  if (options.orchSocketPath && options.orchSocketPath.trim()) {
    return options.orchSocketPath.trim();
  }
  if (process.env.ZEE_IPC_SOCKET?.trim()) {
    return process.env.ZEE_IPC_SOCKET.trim();
  }
  return resolveDefaultOrchSocketPath();
}

function cleanupLegacySocketIfMigrated(activeSocketPath: string): void {
  const legacySocketPath = resolveLegacyOrchSocketPath();
  if (path.resolve(activeSocketPath) === path.resolve(legacySocketPath)) return;

  try {
    const stat = fs.lstatSync(legacySocketPath);
    if (!stat.isSocket()) return;
    fs.unlinkSync(legacySocketPath);
    log.info("removed legacy orchestration socket", { path: legacySocketPath });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      log.warn("failed to cleanup legacy orchestration socket", {
        path: legacySocketPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function defaultOrchMaxWorkers(): number {
  const cores = (() => {
    try {
      return typeof os.availableParallelism === "function"
        ? os.availableParallelism()
        : os.cpus().length;
    } catch {
      return 2;
    }
  })();
  return Math.max(2, Math.min(8, cores - 1));
}

function resolveServiceWorkingDirectory(options: DaemonInstallOptions): string {
  if (options.workingDirectory && options.workingDirectory.trim()) {
    return options.workingDirectory.trim();
  }
  // Prefer the detected repository/source root so daemon state and local tools resolve consistently.
  const source = Global.Path.source;
  return source && source.trim() ? source : os.homedir();
}

// =============================================================================
// Linux systemd
// =============================================================================

function generateSystemdDaemonUnit(
  binaryPath: string,
  options: DaemonInstallOptions
): string {
  const args = ["daemon"];
  const workDir = resolveServiceWorkingDirectory(options);

  if (options.port) args.push("--port", String(options.port));
  if (options.hostname) args.push("--hostname", options.hostname);
  if (options.gatewayForce) args.push("--gateway-force");
  if (options.wezterm === false) args.push("--no-wezterm");
  args.push("--directory", workDir);
  // Always enable runtime process guard for installed daemon services.
  args.push("--runtime-guard", "--runtime-guard-interval-ms", "30000");

  const execStart = [binaryPath, ...args].join(" ");
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
KillMode=control-group
TimeoutStopSec=15
SendSIGKILL=yes

# Environment
${envLines}

# Logging
StandardOutput=append:${STDOUT_LOG}
StandardError=append:${STDERR_LOG}

[Install]
WantedBy=default.target
`;
}

function generateSystemdOrchestrationUnit(
  binaryPath: string,
  options: DaemonInstallOptions
): string {
  const workDir = resolveServiceWorkingDirectory(options);
  const args = [
    "daemon-orch",
    "--ipc-socket",
    resolveOrchSocketPath(options),
  ];

  if (options.orchMaxWorkers) args.push("--max-workers", String(options.orchMaxWorkers));
  if (options.orchQueueCap) args.push("--queue-cap", String(options.orchQueueCap));
  if (options.orchQueueDropPolicy) args.push("--queue-drop-policy", options.orchQueueDropPolicy);
  if (options.orchQueueDedupeMode) args.push("--queue-dedupe-mode", options.orchQueueDedupeMode);

  const execStart = [binaryPath, ...args].join(" ");
  const env = buildServiceEnv(options);
  if (!options.orchMaxWorkers) {
    env.ZEE_ORCH_MAX_WORKERS = String(defaultOrchMaxWorkers());
  }
  const envLines = Object.entries(env)
    .map(([k, v]) => `Environment="${k}=${v}"`)
    .join("\n");

  return `[Unit]
Description=Zee Orchestration Daemon - Worker Pool
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
KillMode=control-group
TimeoutStopSec=15
SendSIGKILL=yes

# Environment
${envLines}

# Logging
StandardOutput=append:${ORCH_STDOUT_LOG}
StandardError=append:${ORCH_STDERR_LOG}

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
  const orchestrationEnabled = options.orchestration !== false;
  const orchSocketPath = resolveOrchSocketPath(options);

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

  // Stop existing services if running
  try {
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    });
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_ORCH_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    });
  } catch {
    // Ignore if not running
  }

  cleanupLegacySocketIfMigrated(orchSocketPath);

  // Generate and write unit files
  const unit = generateSystemdDaemonUnit(binaryPath, options);
  try {
    fs.writeFileSync(SYSTEMD_UNIT_PATH, unit, { mode: 0o644 });
    log.info("wrote systemd unit", { path: SYSTEMD_UNIT_PATH });

    if (orchestrationEnabled) {
      const orchUnit = generateSystemdOrchestrationUnit(binaryPath, options);
      fs.writeFileSync(SYSTEMD_ORCH_UNIT_PATH, orchUnit, { mode: 0o644 });
      log.info("wrote systemd unit", { path: SYSTEMD_ORCH_UNIT_PATH });
    } else {
      if (fs.existsSync(SYSTEMD_ORCH_UNIT_PATH)) {
        fs.unlinkSync(SYSTEMD_ORCH_UNIT_PATH);
      }
      spawnSync("systemctl", ["--user", "disable", SYSTEMD_ORCH_UNIT_NAME], {
        stdio: "pipe",
        timeout: 10000,
      });
    }
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
        orchestrationServicePath: orchestrationEnabled ? SYSTEMD_ORCH_UNIT_PATH : undefined,
        error: `systemctl daemon-reload failed: ${result.stderr?.toString()}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      platform: "linux",
      servicePath: SYSTEMD_UNIT_PATH,
      orchestrationServicePath: orchestrationEnabled ? SYSTEMD_ORCH_UNIT_PATH : undefined,
      error: `Failed to reload systemd: ${err}`,
    };
  }

  // Enable and start services
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

    if (orchestrationEnabled) {
      spawnSync("systemctl", ["--user", "enable", SYSTEMD_ORCH_UNIT_NAME], {
        stdio: "pipe",
        timeout: 10000,
      });
      const orchStartResult = spawnSync("systemctl", ["--user", "start", SYSTEMD_ORCH_UNIT_NAME], {
        stdio: "pipe",
        timeout: 10000,
      });
      if (orchStartResult.status !== 0) {
        hints.push(`Orchestration service may need manual start: systemctl --user start ${SYSTEMD_ORCH_UNIT_NAME}`);
      }
    }
  } catch {
    hints.push(`Service may need manual start: systemctl --user start ${SYSTEMD_UNIT_NAME}`);
    if (orchestrationEnabled) {
      hints.push(`Orchestration service may need manual start: systemctl --user start ${SYSTEMD_ORCH_UNIT_NAME}`);
    }
  }

  hints.push(`Logs: journalctl --user -u ${SYSTEMD_UNIT_NAME} -f`);
  hints.push(`Or: ${STDOUT_LOG}`);
  hints.push(`Stop: systemctl --user stop ${SYSTEMD_UNIT_NAME}`);
  hints.push(`Restart: systemctl --user restart ${SYSTEMD_UNIT_NAME}`);
  hints.push(`Status: systemctl --user status ${SYSTEMD_UNIT_NAME}`);
  if (orchestrationEnabled) {
    hints.push(`Orch logs: journalctl --user -u ${SYSTEMD_ORCH_UNIT_NAME} -f`);
    hints.push(`Or: ${ORCH_STDOUT_LOG}`);
    hints.push(`Orch stop: systemctl --user stop ${SYSTEMD_ORCH_UNIT_NAME}`);
    hints.push(`Orch restart: systemctl --user restart ${SYSTEMD_ORCH_UNIT_NAME}`);
    hints.push(`Orch status: systemctl --user status ${SYSTEMD_ORCH_UNIT_NAME}`);
  }

  return {
    success: true,
    platform: "linux",
    servicePath: SYSTEMD_UNIT_PATH,
    orchestrationServicePath: orchestrationEnabled ? SYSTEMD_ORCH_UNIT_PATH : undefined,
    hints,
  };
}

async function uninstallSystemdService(): Promise<DaemonInstallResult> {
  try {
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    });
    spawnSync("systemctl", ["--user", "stop", SYSTEMD_ORCH_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    });
    spawnSync("systemctl", ["--user", "disable", SYSTEMD_UNIT_NAME], {
      stdio: "pipe",
      timeout: 10000,
    });
    spawnSync("systemctl", ["--user", "disable", SYSTEMD_ORCH_UNIT_NAME], {
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
    if (fs.existsSync(SYSTEMD_ORCH_UNIT_PATH)) {
      fs.unlinkSync(SYSTEMD_ORCH_UNIT_PATH);
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
    hints: ["systemd services removed successfully"],
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
        "Install with: bun install -g zee",
        "Or: npm install -g zee",
      ],
    };
  }

  log.info("resolved binary", { path: binaryPath });

  // Check if already installed (unless force)
  if (!options.force) {
    const daemonInstalled = fs.existsSync(SYSTEMD_UNIT_PATH);
    const orchInstalled = fs.existsSync(SYSTEMD_ORCH_UNIT_PATH);
    if (daemonInstalled && orchInstalled) {
      return {
        success: true,
        platform,
        servicePath: SYSTEMD_UNIT_PATH,
        orchestrationServicePath: SYSTEMD_ORCH_UNIT_PATH,
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

type UnitStatus = {
  name: string;
  path: string;
  installed: boolean;
  running: boolean;
  enabled: boolean;
}

function getUnitStatus(name: string, servicePath: string): UnitStatus {
  const installed = fs.existsSync(servicePath);
  let running = false;
  let enabled = false;

  if (installed) {
    try {
      const activeResult = spawnSync(
        "systemctl",
        ["--user", "is-active", name],
        { stdio: "pipe", timeout: 5000 }
      );
      running = activeResult.stdout?.toString().trim() === "active";
    } catch {
      running = false;
    }

    try {
      const enabledResult = spawnSync(
        "systemctl",
        ["--user", "is-enabled", name],
        { stdio: "pipe", timeout: 5000 }
      );
      enabled = enabledResult.stdout?.toString().trim() === "enabled";
    } catch {
      enabled = false;
    }
  }

  return {
    name,
    path: servicePath,
    installed,
    running,
    enabled,
  };
}

export function getDaemonServiceStatus(): {
  installed: boolean;
  running: boolean;
  platform: string;
  servicePath?: string;
  orchestrationServicePath?: string;
  units: {
    daemon: UnitStatus;
    orchestration: UnitStatus;
  };
} {
  const platform = getPlatform();

  if (platform === "unsupported") {
    const daemon = {
      name: SYSTEMD_UNIT_NAME,
      path: SYSTEMD_UNIT_PATH,
      installed: false,
      running: false,
      enabled: false,
    };
    const orchestration = {
      name: SYSTEMD_ORCH_UNIT_NAME,
      path: SYSTEMD_ORCH_UNIT_PATH,
      installed: false,
      running: false,
      enabled: false,
    };
    return {
      installed: false,
      running: false,
      platform: os.platform(),
      units: { daemon, orchestration },
    };
  }

  const daemon = getUnitStatus(SYSTEMD_UNIT_NAME, SYSTEMD_UNIT_PATH);
  const orchestration = getUnitStatus(SYSTEMD_ORCH_UNIT_NAME, SYSTEMD_ORCH_UNIT_PATH);
  const installed = daemon.installed && orchestration.installed;
  const running = daemon.running && orchestration.running;

  return {
    installed,
    running,
    platform,
    servicePath: SYSTEMD_UNIT_PATH,
    orchestrationServicePath: SYSTEMD_ORCH_UNIT_PATH,
    units: { daemon, orchestration },
  };
}

// =============================================================================
// CLI Commands
// =============================================================================

export const DaemonInstallCommand = cmd({
  command: "daemon-install",
  describe: "Install zee daemon + orchestration daemons as user systemd services (Linux)",
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
      .option("orch-socket", {
        describe: "Unix socket path for orchestration daemon IPC",
        type: "string",
      })
      .option("orch-max-workers", {
        describe: "Maximum orchestration workers (default: CPU-based auto)",
        type: "number",
      })
      .option("orch-queue-cap", {
        describe: "Orchestration queue capacity",
        type: "number",
      })
      .option("orch-queue-drop-policy", {
        describe: "Orchestration queue overflow policy",
        type: "string",
        choices: ["old", "new", "summarize"],
      })
      .option("orch-queue-dedupe-mode", {
        describe: "Orchestration queue dedupe mode",
        type: "string",
        choices: ["task-id", "prompt", "none"],
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
      gateway: true,
      gatewayForce: args["gateway-force"] as boolean,
      wezterm: args.wezterm as boolean,
      orchSocketPath: args["orch-socket"] as string | undefined,
      orchMaxWorkers: args["orch-max-workers"] as number | undefined,
      orchQueueCap: args["orch-queue-cap"] as number | undefined,
      orchQueueDropPolicy: args["orch-queue-drop-policy"] as "old" | "new" | "summarize" | undefined,
      orchQueueDedupeMode: args["orch-queue-dedupe-mode"] as "task-id" | "prompt" | "none" | undefined,
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
      const anyInstalled = status.units.daemon.installed || status.units.orchestration.installed;
      if (anyInstalled && !options.force) {
        const installedUnits = [
          status.units.daemon.installed ? "daemon" : "",
          status.units.orchestration.installed ? "orchestration" : "",
        ].filter(Boolean).join(" + ");
        const reinstall = await prompts.confirm({
          message: `Service already installed (${installedUnits}). Reinstall?`,
          initialValue: false,
        });
        if (prompts.isCancel(reinstall) || !reinstall) {
          prompts.outro("Installation cancelled.");
          process.exit(0);
        }
        options.force = true;
      }

      prompts.log.step("Installing service...");
    }

    const result = await installDaemon(options);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.success) {
      UI.success("Zee services installed successfully!");
      console.log(`\nService: ${result.servicePath}`);
      if (result.orchestrationServicePath) {
        console.log(`Orchestration service: ${result.orchestrationServicePath}`);
      }
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
  describe: "Uninstall zee daemon services",
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
      UI.success("Zee daemon services removed.");
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
  describe: "Check zee daemon services status",
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
      console.log(`  Installed (all required units): ${status.installed ? "yes" : "no"}`);
      console.log(`  Running (all required units):   ${status.running ? "yes" : "no"}`);
      console.log("");
      console.log(`  ${status.units.daemon.name}`);
      console.log(`    Installed: ${status.units.daemon.installed ? "yes" : "no"}`);
      console.log(`    Running:   ${status.units.daemon.running ? "yes" : "no"}`);
      console.log(`    Enabled:   ${status.units.daemon.enabled ? "yes" : "no"}`);
      console.log(`    Path:      ${status.units.daemon.path}`);
      console.log(`  ${status.units.orchestration.name}`);
      console.log(`    Installed: ${status.units.orchestration.installed ? "yes" : "no"}`);
      console.log(`    Running:   ${status.units.orchestration.running ? "yes" : "no"}`);
      console.log(`    Enabled:   ${status.units.orchestration.enabled ? "yes" : "no"}`);
      console.log(`    Path:      ${status.units.orchestration.path}`);
    }
  },
});
