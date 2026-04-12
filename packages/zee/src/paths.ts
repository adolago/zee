/**
 * Centralized Path Resolution
 *
 * All assistant and asset paths are resolved from ZEE_ROOT.
 * No need for repo env vars like ZEE_REPO, etc.
 */

import path from "path"
import fs from "fs"
import { resolveConfigDir, resolveDataDir } from "./global/dirs"

function findZeeRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir)
  for (;;) {
    const packageRoot = path.join(current, "packages", "zee")
    const zeeDir = path.join(current, ".zee")
    if (fs.existsSync(packageRoot) || fs.existsSync(zeeDir)) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Get the Zee root directory.
 * Order of precedence:
 * 1. ZEE_ROOT env var (set by binary or launcher)
 * 2. ZEE_SOURCE env var
 * 3. Walk up from cwd/argv/exec paths
 */
export function getZeeRoot(): string {
  if (process.env.ZEE_ROOT) {
    return process.env.ZEE_ROOT!
  }

  const envSource = process.env.ZEE_SOURCE
  if (envSource) return envSource

  const starts = [process.cwd()]
  const argvPath = process.argv[1]
  if (argvPath) starts.push(path.dirname(path.resolve(argvPath)))
  starts.push(path.dirname(process.execPath))

  for (const start of starts) {
    const root = findZeeRoot(start)
    if (root) return root
  }

  return process.cwd()
}

function pathImpl(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? path.win32 : path.posix
}

function getDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return resolveDataDir(env, platform)
}

/**
 * Domain paths resolved from the repo root.
 */
export const Domains = {
  root(): string {
    return getZeeRoot()
  },

  zee(): string {
    return path.join(this.root(), "src", "domain", "zee")
  },

  learning(): string {
    return path.join(this.root(), "src", "domain", "learning")
  },

  exists(name: "zee" | "learning"): boolean {
    return fs.existsSync(this[name]())
  },
}

export const OpenBB = {
  apiUrl(env: NodeJS.ProcessEnv = process.env): string {
    return env.ZEE_OPENBB_API_URL?.trim() || "http://127.0.0.1:6900"
  },

  apiUrlOverridden(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.ZEE_OPENBB_API_URL?.trim())
  },

  apiCommand(env: NodeJS.ProcessEnv = process.env): string {
    return env.ZEE_OPENBB_API_CMD?.trim() || "openbb-api"
  },

  installDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    return env.ZEE_OPENBB_HOME?.trim() || pathImpl(platform).join(getDataDir(env, platform), "openbb")
  },

  venvDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    return pathImpl(platform).join(this.installDir(env, platform), ".venv")
  },

  managedBinDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    return platform === "win32"
      ? path.win32.join(this.venvDir(env, platform), "Scripts")
      : path.posix.join(this.venvDir(env, platform), "bin")
  },

  managedPythonPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    return platform === "win32"
      ? path.win32.join(this.managedBinDir(env, platform), "python.exe")
      : path.posix.join(this.managedBinDir(env, platform), "python")
  },

  managedApiCommandPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    return platform === "win32"
      ? path.win32.join(this.managedBinDir(env, platform), "openbb-api.exe")
      : path.posix.join(this.managedBinDir(env, platform), "openbb-api")
  },

  managedBuildCommandPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    return platform === "win32"
      ? path.win32.join(this.managedBinDir(env, platform), "openbb-build.exe")
      : path.posix.join(this.managedBinDir(env, platform), "openbb-build")
  },

  workspaceOrigins(): string[] {
    return ["https://pro.openbb.co", "https://openbb.co", "https://my.openbb.co"]
  },

  preflight(): string | null {
    const configuredApiUrl = process.env.ZEE_OPENBB_API_URL?.trim() || this.apiUrl()
    try {
      new URL(configuredApiUrl)
      return null
    } catch {
      return `Configured ZEE_OPENBB_API_URL is invalid: ${configuredApiUrl}.\nSet ZEE_OPENBB_API_URL to a valid OpenBB Platform API base URL.`
    }
  },
}

/**
 * Learning-specific paths
 */
export const Learning = {
  repo(): string {
    return process.env.ZEE_LEARNING_REPO || Domains.learning()
  },

  cli(): string {
    return process.env.ZEE_LEARNING_CLI || path.join(this.repo(), "scripts", "learning_cli.py")
  },
}

/**
 * Zee-specific paths
 */
export const Zee = {
  repo(): string {
    return process.env.ZEE_REPO || Domains.zee()
  },

  /**
   * Zee config directory (XDG) - ~/.config/zee/
   * Used for user configuration such as zee.jsonc.
   */
  dataDir(): string {
    return resolveConfigDir()
  },

  credentials(): string {
    return path.join(this.dataDir(), "credentials")
  },
}

/**
 * Zee assets paths
 */
export const Assets = {
  root(): string {
    return path.join(getZeeRoot(), ".zee")
  },

  agents(): string {
    return path.join(this.root(), "agent")
  },

  themes(): string {
    return path.join(this.root(), "themes")
  },

  skills(): string {
    return path.join(this.root(), "skill")
  },

  config(): string {
    return path.join(this.root(), "zee.jsonc")
  },
}
