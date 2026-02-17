export type SystemdScope = "user" | "system"

export type SystemdServiceState = {
  available: boolean
  installed: boolean
  active: boolean
  status?: string
}

export type DaemonStateLike = {
  pid: number
}

export type RecoveryDependencies = {
  restartSystemd: (scope: SystemdScope) => { ok: boolean; details?: string }
  stopPid: (pid: number) => Promise<{ ok: boolean; details?: string }>
  cleanupState: () => Promise<void>
}

export type UnhealthyRecoveryResult =
  | {
      ok: true
      action: "systemd-user-restart" | "systemd-system-restart" | "force-replace"
    }
  | {
      ok: false
      action: "systemd-user-restart" | "systemd-system-restart" | "force-replace"
      details: string
    }

export async function recoverUnhealthyDaemonForStartup(
  options: {
    systemdUser: SystemdServiceState
    systemdSystem: SystemdServiceState
    state: DaemonStateLike | null
  },
  deps: RecoveryDependencies,
): Promise<UnhealthyRecoveryResult> {
  if (options.systemdUser.available && options.systemdUser.installed) {
    const restarted = deps.restartSystemd("user")
    if (!restarted.ok) {
      return {
        ok: false,
        action: "systemd-user-restart",
        details: restarted.details ?? "systemctl --user restart zee failed",
      }
    }
    return { ok: true, action: "systemd-user-restart" }
  }

  if (options.systemdSystem.available && options.systemdSystem.installed) {
    const restarted = deps.restartSystemd("system")
    if (!restarted.ok) {
      return {
        ok: false,
        action: "systemd-system-restart",
        details: restarted.details ?? "systemctl restart zee failed",
      }
    }
    return { ok: true, action: "systemd-system-restart" }
  }

  if (options.state?.pid) {
    const stopped = await deps.stopPid(options.state.pid)
    if (!stopped.ok) {
      return {
        ok: false,
        action: "force-replace",
        details: stopped.details ?? `Failed to stop process ${options.state.pid}`,
      }
    }
  }

  await deps.cleanupState()
  return { ok: true, action: "force-replace" }
}
