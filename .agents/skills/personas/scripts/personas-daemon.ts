#!/usr/bin/env npx tsx
/**
 * personas-daemon CLI
 *
 * Starts the agent-core daemon (tiara + LSP).
 *
 * Usage:
 *   npx tsx personas-daemon.ts start [--lsp-port <port>] [--lsp-host <host>]
 *   npx tsx personas-daemon.ts status
 *   npx tsx personas-daemon.ts stop
 *   npx tsx personas-daemon.ts restart
 */

import { spawn } from "node:child_process";
import { existsSync, openSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { requestDaemon } from "../../../../src/daemon/ipc-client";

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function resolveAgentCoreRoot(): string {
  return process.env.AGENT_CORE_ROOT || join(homedir(), "Repositories", "agent-core");
}

function startDaemon() {
  const root = resolveAgentCoreRoot();
  const entry = join(root, "src", "daemon", "index.ts");
  if (!existsSync(entry)) {
    console.error(`Daemon entry not found: ${entry}`);
    console.error("Set AGENT_CORE_ROOT or run from agent-core repo.");
    process.exit(1);
  }

  const lspPort = getArg("lsp-port");
  const lspHost = getArg("lsp-host");
  const ipcSocket = getArg("ipc-socket");
  const daemonArgs = ["run", entry];
  if (lspPort) daemonArgs.push("--lsp-port", lspPort);
  if (lspHost) daemonArgs.push("--lsp-host", lspHost);
  if (ipcSocket) daemonArgs.push("--ipc-socket", ipcSocket);

  const logFile = join(homedir(), ".zee", "agent-core", "daemon.log");
  const logFd = openSync(logFile, "a");

  const child = spawn("bun", daemonArgs, {
    stdio: ["ignore", logFd, logFd],
    detached: true,
    cwd: root, // Ensure cwd is correct
    env: { ...process.env, AGENT_CORE_IPC_SOCKET: ipcSocket }
  });

  child.unref();
  console.log(`Daemon started (PID ${child.pid}).`);
  process.exit(0);
}

async function statusDaemon() {
  const status = await requestDaemon("status");
  console.log(JSON.stringify(status, null, 2));
}

async function stopDaemon() {
  await requestDaemon("shutdown", undefined, { timeoutMs: 20000 });
  console.log("Daemon shutdown requested.");
}

async function restartDaemon() {
  try {
    await stopDaemon();
  } catch (err) {
    console.warn(`Daemon stop skipped: ${(err as Error).message}`);
  }
  startDaemon();
}

async function spawnDrone() {
  const persona = getArg("persona");
  const task = getArg("task");
  const prompt = getArg("prompt");
  if (!persona || !task || !prompt) {
    console.error("spawn requires --persona, --task, and --prompt");
    process.exit(1);
  }
  const result = await requestDaemon("spawn_drone", { persona, task, prompt });
  console.log(JSON.stringify(result, null, 2));
}

async function submitTask() {
  const persona = getArg("persona");
  const description = getArg("description");
  const prompt = getArg("prompt");
  if (!persona || !description || !prompt) {
    console.error("submit requires --persona, --description, and --prompt");
    process.exit(1);
  }
  const result = await requestDaemon("submit_task", {
    persona,
    description,
    prompt,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function listWorkers() {
  const result = await requestDaemon("list_workers");
  console.log(JSON.stringify(result, null, 2));
}

async function listTasks() {
  const result = await requestDaemon("list_tasks");
  console.log(JSON.stringify(result, null, 2));
}

async function killWorker() {
  const workerId = getArg("workerId");
  if (!workerId) {
    console.error("kill-worker requires --workerId");
    process.exit(1);
  }
  const result = await requestDaemon("kill_worker", { workerId });
  console.log(JSON.stringify(result, null, 2));
}

switch (command) {
  case "start":
    startDaemon();
    break;
  case "status":
    statusDaemon().catch((err) => {
      console.error(`Status failed: ${err.message}`);
      process.exit(1);
    });
    break;
  case "stop":
    stopDaemon().catch((err) => {
      console.error(`Stop failed: ${err.message}`);
      process.exit(1);
    });
    break;
  case "restart":
    restartDaemon();
    break;
  case "kill-worker":
    killWorker().catch((err) => {
      console.error(`Kill worker failed: ${err.message}`);
      process.exit(1);
    });
    break;
  case "spawn":
    spawnDrone().catch((err) => {
      console.error(`Spawn failed: ${err.message}`);
      process.exit(1);
    });
    break;
  case "submit":
    submitTask().catch((err) => {
      console.error(`Submit failed: ${err.message}`);
      process.exit(1);
    });
    break;
  case "list-workers":
    listWorkers().catch((err) => {
      console.error(`List workers failed: ${err.message}`);
      process.exit(1);
    });
    break;
  case "list-tasks":
    listTasks().catch((err) => {
      console.error(`List tasks failed: ${err.message}`);
      process.exit(1);
    });
    break;
  default:
    console.log(`
personas daemon CLI

Commands:
  start [--lsp-port p] [--lsp-host h] [--ipc-socket path]
  status
  stop
  restart
  spawn --persona <p> --task <t> --prompt <p>
  submit --persona <p> --description <d> --prompt <p>
  list-workers
  list-tasks

Examples:
  personas-daemon.ts start --lsp-port 7777
  personas-daemon.ts status
  personas-daemon.ts spawn --persona zee --task "Plan" --prompt "Draft plan"
`);
}
