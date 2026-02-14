import process from "node:process";

import { isTruthyEnvValue } from "../infra/env.js";

export const PARENT_PID_ENV = "ZEE_PARENT_PID";
export const SUBAGENT_ENV = "ZEE_IS_SUBAGENT";
export const DISABLE_PARENT_GUARD_ENV = "ZEE_DISABLE_PARENT_GUARD";
const DEFAULT_CHECK_INTERVAL_MS = 2_000;

export type ParentGuardOptions = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  ppid?: number;
  pid?: number;
};

export function parseParentPid(value: string | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  if (normalized <= 1) return undefined;
  return normalized;
}

export function resolveParentGuardPid(options: ParentGuardOptions = {}): number | undefined {
  const env = options.env ?? process.env;
  if (isTruthyEnvValue(env[DISABLE_PARENT_GUARD_ENV])) return undefined;

  const explicit = parseParentPid(env[PARENT_PID_ENV]);
  if (explicit !== undefined) return explicit;

  const isSubagent = isTruthyEnvValue(env[SUBAGENT_ENV]);
  if (!isSubagent) return undefined;

  const ppid = options.ppid ?? process.ppid;
  if (!Number.isFinite(ppid) || ppid <= 1) return undefined;
  return Math.floor(ppid);
}

export function isProcessAlive(
  pid: number,
  killFn: (pid: number, signal?: number | NodeJS.Signals) => void = process.kill,
): boolean {
  try {
    killFn(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EPERM") return true;
    return false;
  }
}

export function shouldExitForMissingParent(params: {
  expectedParentPid: number;
  currentPpid: number;
  parentAlive: boolean;
}): boolean {
  if (params.currentPpid <= 1) return true;
  if (params.currentPpid !== params.expectedParentPid) return true;
  if (!params.parentAlive) return true;
  return false;
}

export type InstallParentGuardOptions = {
  expectedParentPid?: number;
  intervalMs?: number;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  getPpid?: () => number;
  isAlive?: (pid: number) => boolean;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  onOrphaned?: (expectedParentPid: number) => void;
  exitFn?: (code?: number) => never | void;
  logger?: (line: string) => void;
};

export function installParentProcessGuard(
  options: InstallParentGuardOptions = {},
): { stop: () => void } | undefined {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const pid = process.pid;
  const expectedParentPid = options.expectedParentPid ?? resolveParentGuardPid({ env });
  if (!expectedParentPid || expectedParentPid <= 1 || expectedParentPid === pid) {
    return undefined;
  }

  // Never parent-guard the long-running daemon service unless explicitly requested.
  const daemonCommand = argv.slice(2)[0] === "daemon";
  if (daemonCommand && !isTruthyEnvValue(env.ZEE_FORCE_PARENT_GUARD)) {
    return undefined;
  }

  const getPpid = options.getPpid ?? (() => process.ppid);
  const isAlive = options.isAlive ?? ((parentPid: number) => isProcessAlive(parentPid));
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const exitFn = options.exitFn ?? ((code?: number) => process.exit(code));
  const logger = options.logger ?? ((line: string) => console.error(line));
  const checkIntervalMs =
    typeof options.intervalMs === "number" && options.intervalMs >= 200
      ? Math.floor(options.intervalMs)
      : DEFAULT_CHECK_INTERVAL_MS;

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearIntervalFn(timer);
  };

  const check = (): void => {
    if (stopped) return;
    const currentPpid = getPpid();
    const parentAlive = isAlive(expectedParentPid);
    if (
      shouldExitForMissingParent({
        expectedParentPid,
        currentPpid,
        parentAlive,
      })
    ) {
      stop();
      options.onOrphaned?.(expectedParentPid);
      logger(`[zee] parent process ${expectedParentPid} is gone; exiting to prevent orphaned workers.`);
      exitFn(0);
    }
  };

  const timer = setIntervalFn(check, checkIntervalMs);
  timer.unref?.();
  process.once("exit", stop);
  check();
  return { stop };
}

