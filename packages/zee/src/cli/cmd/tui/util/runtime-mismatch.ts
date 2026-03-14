export type RuntimeBuildInfo = {
  version?: string
  execPath?: string
}

export function hasDaemonRuntimeMismatch(daemon: RuntimeBuildInfo | undefined, runtime: RuntimeBuildInfo) {
  if (!daemon) return false
  return daemon.version !== runtime.version || daemon.execPath !== runtime.execPath
}

export function getDaemonRuntimeMismatchWarning(daemon: RuntimeBuildInfo | undefined, runtime: RuntimeBuildInfo) {
  if (!hasDaemonRuntimeMismatch(daemon, runtime)) return undefined
  return "Daemon build differs from this TUI. Restart Zee daemon to pick up current provider and model changes."
}
