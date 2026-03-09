/**
 * Centralized Path Resolution
 *
 * All assistant and asset paths are resolved from ZEE_ROOT.
 * No need for env vars like ZEE_INVESTING_REPO, ZEE_REPO, etc.
 */

import path from "path"
import fs from "fs"
import os from "os"
import { execFileSync } from "child_process"

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

  investing(): string {
    return path.join(this.root(), "src", "domain", "investing")
  },

  learning(): string {
    return path.join(this.root(), "src", "domain", "learning")
  },

  exists(name: "zee" | "investing" | "learning"): boolean {
    return fs.existsSync(this[name]())
  },
}

/**
 * Investing-specific paths
 */
export const Investing = {
  repo(): string {
    return process.env.ZEE_INVESTING_REPO || path.join(getZeeRoot(), "investing")
  },

  coreProject(): string {
    return path.join(getZeeRoot(), "packages", "investing-core")
  },

  coreBin(): string | undefined {
    const configured = process.env.ZEE_INVESTING_CORE_BIN?.trim()
    return configured || undefined
  },
  portfolioFile(): string {
    return process.env.ZEE_INVESTING_PORTFOLIO_FILE || path.join(os.homedir(), ".zee", "investing", "portfolio.json")
  },

  /** Get the investing API base URL from env or default. */
  apiUrl(): string {
    return process.env.ZEE_INVESTING_API_URL || "http://127.0.0.1:8000"
  },

  /**
   * Preflight check — verify the investing core runtime is ready to run.
   * Returns null if everything is OK, or an error message string.
   */
  preflight(): string | null {
    const configuredApiUrl = process.env.ZEE_INVESTING_API_URL?.trim()
    if (configuredApiUrl) {
      try {
        new URL(configuredApiUrl)
        return null
      } catch {
        return (
          `Configured ZEE_INVESTING_API_URL is invalid: ${configuredApiUrl}.\n` +
          `Set ZEE_INVESTING_API_URL to a valid investing base URL or configure ZEE_INVESTING_CORE_BIN for local autostart.`
        )
      }
    }

    const coreBin = this.coreBin()
    if (!coreBin) {
      return (
        `Investing core binary is not configured.\n` +
        `Set ZEE_INVESTING_CORE_BIN to a built investing executable path, or set ZEE_INVESTING_API_URL to an existing investing runtime.\n` +
        `Example:\n` +
        `  export ZEE_INVESTING_CORE_BIN=${path.join(this.coreProject(), "target", "release", "investing")}`
      )
    }

    try {
      execFileSync(coreBin, ["--version"], {
        timeout: 10_000,
        stdio: "pipe",
      })
      return null
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === "ENOENT" || err.code === "EACCES") {
        return (
          `Configured investing core binary is not executable: ${coreBin}.\n` +
          `Set ZEE_INVESTING_CORE_BIN to a valid investing executable path.`
        )
      }
      return (
        `Configured investing core binary failed its startup probe: ${coreBin}.\n` +
        `Run it manually to inspect the failure or rebuild packages/investing-core.`
      )
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
    const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim()
    if (xdgConfigHome) return path.join(xdgConfigHome, "zee")
    return path.join(os.homedir(), ".config", "zee")
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
