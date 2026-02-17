import { describe, expect, test } from "bun:test"
import { recoverUnhealthyDaemonForStartup, type SystemdServiceState } from "../../../src/cli/cmd/tui/recovery"

function state(overrides: Partial<SystemdServiceState> = {}): SystemdServiceState {
  return {
    available: false,
    installed: false,
    active: false,
    ...overrides,
  }
}

describe("tui thread unhealthy daemon recovery", () => {
  test("uses systemd user restart when user service is installed", async () => {
    const calls: string[] = []
    const result = await recoverUnhealthyDaemonForStartup(
      {
        systemdUser: state({ available: true, installed: true, active: true }),
        systemdSystem: state({ available: true, installed: true, active: true }),
        state: { pid: 111 },
      },
      {
        restartSystemd: (scope) => {
          calls.push(`restart:${scope}`)
          return { ok: true }
        },
        stopPid: async (pid) => {
          calls.push(`stop:${pid}`)
          return { ok: true }
        },
        cleanupState: async () => {
          calls.push("cleanup")
        },
      },
    )

    expect(result).toEqual({ ok: true, action: "systemd-user-restart" })
    expect(calls).toEqual(["restart:user"])
  })

  test("returns failure when systemd user restart fails", async () => {
    const result = await recoverUnhealthyDaemonForStartup(
      {
        systemdUser: state({ available: true, installed: true }),
        systemdSystem: state(),
        state: { pid: 222 },
      },
      {
        restartSystemd: () => ({ ok: false, details: "restart denied" }),
        stopPid: async () => ({ ok: true }),
        cleanupState: async () => {},
      },
    )

    expect(result).toEqual({
      ok: false,
      action: "systemd-user-restart",
      details: "restart denied",
    })
  })

  test("force-replaces unmanaged daemon by stopping pid and cleaning state", async () => {
    const calls: string[] = []
    const result = await recoverUnhealthyDaemonForStartup(
      {
        systemdUser: state(),
        systemdSystem: state(),
        state: { pid: 333 },
      },
      {
        restartSystemd: () => ({ ok: true }),
        stopPid: async (pid) => {
          calls.push(`stop:${pid}`)
          return { ok: true }
        },
        cleanupState: async () => {
          calls.push("cleanup")
        },
      },
    )

    expect(result).toEqual({ ok: true, action: "force-replace" })
    expect(calls).toEqual(["stop:333", "cleanup"])
  })

  test("returns failure when unmanaged daemon cannot be stopped", async () => {
    const calls: string[] = []
    const result = await recoverUnhealthyDaemonForStartup(
      {
        systemdUser: state(),
        systemdSystem: state(),
        state: { pid: 444 },
      },
      {
        restartSystemd: () => ({ ok: true }),
        stopPid: async () => ({ ok: false, details: "timeout" }),
        cleanupState: async () => {
          calls.push("cleanup")
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      action: "force-replace",
      details: "timeout",
    })
    expect(calls).toEqual([])
  })
})
