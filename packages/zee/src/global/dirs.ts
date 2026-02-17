import os from "os"
import path from "path"

const APP_NAME = "zee"

function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZEE_TEST_HOME || os.homedir()
}

export function resolveUserPath(input: string, env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = String(input ?? "").trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, getHomeDir(env))
    return path.resolve(expanded)
  }
  return path.resolve(trimmed)
}

export function resolveStateDirOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.ZEE_STATE_DIR?.trim()
  if (!override) return undefined
  return resolveUserPath(override, env)
}

function getXdgDataHome(env: NodeJS.ProcessEnv = process.env) {
  return env.XDG_DATA_HOME || path.join(getHomeDir(env), ".local", "share")
}

function getXdgCacheHome(env: NodeJS.ProcessEnv = process.env) {
  return env.XDG_CACHE_HOME || path.join(getHomeDir(env), ".cache")
}

function getXdgConfigHome(env: NodeJS.ProcessEnv = process.env) {
  return env.XDG_CONFIG_HOME || path.join(getHomeDir(env), ".config")
}

function getXdgStateHome(env: NodeJS.ProcessEnv = process.env) {
  return env.XDG_STATE_HOME || path.join(getHomeDir(env), ".local", "state")
}

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveStateDirOverride(env) || path.join(getXdgStateHome(env), APP_NAME)
}

export function resolveConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.ZEE_CONFIG_DIR?.trim()
  if (direct) return resolveUserPath(direct, env)
  const stateOverride = resolveStateDirOverride(env)
  if (stateOverride) return path.join(stateOverride, "config")
  return path.join(getXdgConfigHome(env), APP_NAME)
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateOverride = resolveStateDirOverride(env)
  if (stateOverride) return path.join(stateOverride, "data")
  return path.join(getXdgDataHome(env), APP_NAME)
}

export function resolveCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateOverride = resolveStateDirOverride(env)
  if (stateOverride) return path.join(stateOverride, "cache")
  return path.join(getXdgCacheHome(env), APP_NAME)
}

export function resolveLogsDir(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.ZEE_LOG_DIR?.trim()
  if (direct) return resolveUserPath(direct, env)
  const stateOverride = resolveStateDirOverride(env)
  if (stateOverride) return path.join(stateOverride, "logs")
  return path.join(resolveStateDir(env), "logs")
}

export function resolveWorkspaceDir(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.ZEE_WORKSPACE_DIR?.trim()
  if (direct) return resolveUserPath(direct, env)
  const stateOverride = resolveStateDirOverride(env)
  if (stateOverride) return path.join(stateOverride, "workspace")
  // Preserve historical default worktree location unless explicitly configured.
  return path.join(resolveDataDir(env), "worktree")
}
