import { describe, expect, it, vi } from "vitest";

import {
  isProcessAlive,
  parseParentPid,
  resolveParentGuardPid,
  shouldExitForMissingParent,
  installParentProcessGuard,
} from "./parent-guard.js";

describe("parent guard", () => {
  it("parses valid parent pids", () => {
    expect(parseParentPid("42")).toBe(42);
    expect(parseParentPid("  99  ")).toBe(99);
  });

  it("rejects invalid parent pids", () => {
    expect(parseParentPid(undefined)).toBeUndefined();
    expect(parseParentPid("")).toBeUndefined();
    expect(parseParentPid("1")).toBeUndefined();
    expect(parseParentPid("-5")).toBeUndefined();
    expect(parseParentPid("abc")).toBeUndefined();
  });

  it("resolves explicit parent pid from env first", () => {
    const pid = resolveParentGuardPid({
      env: { ZEE_PARENT_PID: "777", ZEE_IS_SUBAGENT: "1" },
      ppid: 55,
    });
    expect(pid).toBe(777);
  });

  it("falls back to ppid for subagents", () => {
    const pid = resolveParentGuardPid({
      env: { ZEE_IS_SUBAGENT: "true" },
      ppid: 456,
    });
    expect(pid).toBe(456);
  });

  it("supports disabling the guard via env", () => {
    const pid = resolveParentGuardPid({
      env: { ZEE_IS_SUBAGENT: "1", ZEE_DISABLE_PARENT_GUARD: "1" },
      ppid: 456,
    });
    expect(pid).toBeUndefined();
  });

  it("treats EPERM as process alive", () => {
    const alive = isProcessAlive(123, () => {
      const err = new Error("eperm") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    });
    expect(alive).toBe(true);
  });

  it("detects missing parent conditions", () => {
    expect(
      shouldExitForMissingParent({
        expectedParentPid: 10,
        currentPpid: 1,
        parentAlive: true,
      }),
    ).toBe(true);
    expect(
      shouldExitForMissingParent({
        expectedParentPid: 10,
        currentPpid: 20,
        parentAlive: true,
      }),
    ).toBe(true);
    expect(
      shouldExitForMissingParent({
        expectedParentPid: 10,
        currentPpid: 10,
        parentAlive: false,
      }),
    ).toBe(true);
    expect(
      shouldExitForMissingParent({
        expectedParentPid: 10,
        currentPpid: 10,
        parentAlive: true,
      }),
    ).toBe(false);
  });

  it("exits immediately when parent is gone", () => {
    const exitFn = vi.fn();
    const setIntervalFn = vi.fn((fn: () => void) => {
      // parent guard runs an immediate check, so no need to trigger interval.
      return { unref: vi.fn(), fn } as unknown as NodeJS.Timeout;
    });
    const clearIntervalFn = vi.fn();
    const logger = vi.fn();

    const guard = installParentProcessGuard({
      expectedParentPid: 12345,
      getPpid: () => 1,
      isAlive: () => false,
      setIntervalFn,
      clearIntervalFn,
      exitFn,
      logger,
    });

    expect(guard).toBeDefined();
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(exitFn).toHaveBeenCalledWith(0);
    expect(logger).toHaveBeenCalledTimes(1);
  });

  it("skips daemon process by default", () => {
    const setIntervalFn = vi.fn();
    const guard = installParentProcessGuard({
      expectedParentPid: 12345,
      argv: ["node", "zee", "daemon"],
      setIntervalFn,
    });
    expect(guard).toBeUndefined();
    expect(setIntervalFn).not.toHaveBeenCalled();
  });
});

