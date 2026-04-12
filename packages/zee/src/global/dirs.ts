import os from "os"
import path from "path"

const APP_NAME = "zee"
const WINDOWS_APP_NAME = "Zee"

export type ZeeWindowsScope = "machine" | "user"

function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZEE_TEST_HOME || os.homedir()
}

function pathImpl(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? path.win32 : path
}

function joinForPlatform(platform: NodeJS.Platform, ...parts: string[]): string {
  return pathImpl(platform).join(...parts)
}

export function resolveUserPath(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const trimmed = String(input ?? "").trim()
  if (!trimmed) return trimmed
  const pathApi = pathImpl(platform)
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, getHomeDir(env))
    return pathApi.resolve(expanded)
  }
  return pathApi.resolve(trimmed)
}

function isWindows(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32"
}

export function resolveWindowsScope(env: NodeJS.ProcessEnv = process.env): ZeeWindowsScope {
  const raw = env.ZEE_WINDOWS_SCOPE?.trim().toLowerCase()
  return raw === "machine" ? "machine" : "user"
}

function getWindowsProgramData(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.ZEE_PROGRAMDATA_DIR?.trim()
  if (direct) return resolveUserPath(direct, env, "win32")
  const programData = env.ProgramData || env.PROGRAMDATA
  if (programData) return path.win32.resolve(programData)
  const systemDrive = env.SystemDrive || env.SYSTEMDRIVE || "C:"
  return path.win32.join(systemDrive, "ProgramData")
}

function getWindowsProgramFiles(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.ZEE_PROGRAMFILES_DIR?.trim()
  if (direct) return resolveUserPath(direct, env, "win32")
  return path.win32.resolve(env.ProgramW6432 || env["ProgramFiles"] || "C:\\Program Files")
}

function getWindowsAppData(env: NodeJS.ProcessEnv = process.env): string {
  const appData = env.APPDATA || env.AppData
  if (appData) return path.win32.resolve(appData)
  return path.win32.join(getHomeDir(env), "AppData", "Roaming")
}

function getWindowsLocalAppData(env: NodeJS.ProcessEnv = process.env): string {
  const localAppData = env.LOCALAPPDATA || env.LocalAppData
  if (localAppData) return path.win32.resolve(localAppData)
  return path.win32.join(getHomeDir(env), "AppData", "Local")
}

export function resolveWindowsRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!isWindows(platform)) return path.join(resolveDataHome(env, platform), APP_NAME)
  const scope = resolveWindowsScope(env)
  return scope === "machine"
    ? path.win32.join(getWindowsProgramData(env), WINDOWS_APP_NAME)
    : path.win32.join(getWindowsLocalAppData(env), WINDOWS_APP_NAME)
}

export function resolveStateDirOverride(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const override = env.ZEE_STATE_DIR?.trim()
  if (!override) return undefined
  return resolveUserPath(override, env, platform)
}

function resolveDataHome(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
  if (isWindows(platform)) return getWindowsLocalAppData(env)
  return env.XDG_DATA_HOME || path.join(getHomeDir(env), ".local", "share")
}

function resolveCacheHome(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
  if (isWindows(platform)) return getWindowsLocalAppData(env)
  return env.XDG_CACHE_HOME || path.join(getHomeDir(env), ".cache")
}

function resolveConfigHome(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
  if (isWindows(platform)) return getWindowsAppData(env)
  return env.XDG_CONFIG_HOME || path.join(getHomeDir(env), ".config")
}

function resolveStateHome(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
  if (isWindows(platform)) return resolveWindowsRoot(env, platform)
  return env.XDG_STATE_HOME || path.join(getHomeDir(env), ".local", "state")
}

export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = resolveStateDirOverride(env, platform)
  if (override) return override
  if (isWindows(platform)) return joinForPlatform(platform, resolveWindowsRoot(env, platform), "state")
  return path.join(resolveStateHome(env, platform), APP_NAME)
}

export function resolveConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const direct = env.ZEE_CONFIG_DIR?.trim()
  if (direct) return resolveUserPath(direct, env, platform)
  const stateOverride = resolveStateDirOverride(env, platform)
  if (stateOverride) return joinForPlatform(platform, stateOverride, "config")
  if (isWindows(platform)) {
    const scope = resolveWindowsScope(env)
    return scope === "machine"
      ? joinForPlatform(platform, resolveWindowsRoot(env, platform), "config")
      : joinForPlatform(platform, resolveConfigHome(env, platform), WINDOWS_APP_NAME)
  }
  return path.join(resolveConfigHome(env, platform), APP_NAME)
}

export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const stateOverride = resolveStateDirOverride(env, platform)
  if (stateOverride) return joinForPlatform(platform, stateOverride, "data")
  if (isWindows(platform)) return joinForPlatform(platform, resolveWindowsRoot(env, platform), "data")
  return path.join(resolveDataHome(env, platform), APP_NAME)
}

export function resolveCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const stateOverride = resolveStateDirOverride(env, platform)
  if (stateOverride) return joinForPlatform(platform, stateOverride, "cache")
  if (isWindows(platform)) return joinForPlatform(platform, resolveWindowsRoot(env, platform), "cache")
  return path.join(resolveCacheHome(env, platform), APP_NAME)
}

export function resolveLogsDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const direct = env.ZEE_LOG_DIR?.trim()
  if (direct) return resolveUserPath(direct, env, platform)
  const stateOverride = resolveStateDirOverride(env, platform)
  if (stateOverride) return joinForPlatform(platform, stateOverride, "logs")
  if (isWindows(platform)) return joinForPlatform(platform, resolveWindowsRoot(env, platform), "logs")
  return path.join(resolveStateDir(env, platform), "logs")
}

export function resolveWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const direct = env.ZEE_WORKSPACE_DIR?.trim()
  if (direct) return resolveUserPath(direct, env, platform)
  const stateOverride = resolveStateDirOverride(env, platform)
  if (stateOverride) return joinForPlatform(platform, stateOverride, "workspace")
  if (isWindows(platform)) return joinForPlatform(platform, resolveWindowsRoot(env, platform), "workspace")
  // Preserve historical default worktree location unless explicitly configured.
  return path.join(resolveDataDir(env, platform), "worktree")
}

export function resolvePolicyPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const direct = env.ZEE_POLICY_FILE?.trim()
  if (direct) return resolveUserPath(direct, env, platform)
  if (isWindows(platform))
    return joinForPlatform(platform, getWindowsProgramData(env), WINDOWS_APP_NAME, "policy.jsonc")
  return path.join(resolveConfigDir(env, platform), "policy.jsonc")
}

export function resolveInstallRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const direct = env.ZEE_INSTALL_ROOT?.trim()
  if (direct) return resolveUserPath(direct, env, platform)
  if (isWindows(platform)) return joinForPlatform(platform, getWindowsProgramFiles(env), WINDOWS_APP_NAME)
  return path.join(resolveDataDir(env, platform), "install")
}
