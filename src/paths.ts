/**
 * Centralized Path Resolution
 *
 * All persona and asset paths are resolved from ZEE_ROOT.
 * No need for env vars like STANLEY_REPO, ZEE_REPO, etc.
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
 * Persona paths - resolved from ZEE_ROOT/packages/zee/Swabble/
 */
export const Personas = {
  root(): string {
    return path.join(getZeeRoot(), "packages", "zee", "Swabble")
  },

  zee(): string {
    return this.root()
  },

  stanley(): string {
    return path.join(this.root(), "stanley")
  },

  johny(): string {
    return path.join(this.root(), "johny")
  },

  exists(name: "zee" | "stanley" | "johny"): boolean {
    return fs.existsSync(this[name]())
  },
}

/**
 * Stanley-specific paths
 */
export const Stanley = {
  repo(): string {
    return process.env.STANLEY_REPO || Personas.stanley()
  },

  coreProject(): string {
    return path.join(getZeeRoot(), "packages", "stanley-core")
  },

  coreBin(): string | undefined {
    const configured = process.env.STANLEY_CORE_BIN?.trim()
    return configured || undefined
  },

  portfolioFile(): string {
    return process.env.STANLEY_PORTFOLIO_FILE || path.join(os.homedir(), ".zee", "stanley", "portfolio.json")
  },

  apiUrl(): string {
    return process.env.STANLEY_API_URL || "http://127.0.0.1:8000"
  },

  preflight(): string | null {
    const configuredApiUrl = process.env.STANLEY_API_URL?.trim()
    if (configuredApiUrl) {
      try {
        new URL(configuredApiUrl)
        return null
      } catch {
        return (
          `Configured STANLEY_API_URL is invalid: ${configuredApiUrl}.\n` +
          `Set STANLEY_API_URL to a valid Stanley base URL or configure STANLEY_CORE_BIN for local autostart.`
        )
      }
    }

    const coreBin = this.coreBin()
    if (!coreBin) {
      return (
        `Stanley core binary is not configured.\n` +
        `Set STANLEY_CORE_BIN to a built Stanley executable path, or set STANLEY_API_URL to an existing Stanley runtime.\n` +
        `Example:\n` +
        `  export STANLEY_CORE_BIN=${path.join(this.coreProject(), "target", "release", "stanley")}`
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
          `Configured Stanley core binary is not executable: ${coreBin}.\n` +
          `Set STANLEY_CORE_BIN to a valid Stanley executable path.`
        )
      }
      return (
        `Configured Stanley core binary failed its startup probe: ${coreBin}.\n` +
        `Run it manually to inspect the failure or rebuild packages/stanley-core.`
      )
    }
  },
}

/**
 * Johny-specific paths
 */
export const Johny = {
  repo(): string {
    return process.env.JOHNY_REPO || Personas.johny()
  },

  cli(): string {
    return process.env.JOHNY_CLI || path.join(this.repo(), "scripts", "johny_cli.py")
  },
}

/**
 * Zee-specific paths
 */
export const Zee = {
  repo(): string {
    return process.env.ZEE_REPO || Personas.zee()
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
