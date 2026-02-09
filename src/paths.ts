/**
 * Centralized Path Resolution
 *
 * All persona and asset paths are resolved from ZEE_ROOT.
 * No need for env vars like STANLEY_REPO, ZEE_REPO, etc.
 */

import path from "path"
import fs from "fs"
import os from "os"

/**
 * Get the Zee root directory.
 * Order of precedence:
 * 1. ZEE_ROOT env var (set by binary or launcher)
 * 2. Source development path
 */
export function getZeeRoot(): string {
  const envRoot = process.env.ZEE_ROOT || process.env.AGENT_CORE_ROOT || process.env.OPENCODE_ROOT
  if (envRoot) return envRoot

  // Fallback to common source paths for development.
  const candidates = [
    path.join(os.homedir(), ".local", "src", "zee"),
    path.join(os.homedir(), ".local", "src", "agent-core"), // legacy
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]!
}

/**
 * Backward-compat alias.
 * Prefer getZeeRoot() for new code.
 */
export function getAgentCoreRoot(): string {
  return getZeeRoot()
}

/**
 * Persona paths - resolved from ZEE_ROOT/packages/personas/
 */
export const Personas = {
  root(): string {
    return path.join(getZeeRoot(), "packages", "personas")
  },

  zee(): string {
    return path.join(this.root(), "zee")
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

  cli(): string {
    return process.env.STANLEY_CLI || path.join(this.repo(), "scripts", "stanley_cli.py")
  },

  /**
   * Resolve Python binary for Stanley.
   * Order: STANLEY_PYTHON env > bundled runtime > venv > system python3
   */
  python(): string {
    if (process.env.STANLEY_PYTHON) {
      return process.env.STANLEY_PYTHON
    }

    const repo = this.repo()

    // Check for bundled runtime (dist builds)
    const runtimeBin = path.join(repo, ".python-runtime", "bin")
    for (const bin of ["python3.13", "python3.12", "python3"]) {
      const candidate = path.join(runtimeBin, bin)
      if (fs.existsSync(candidate)) return candidate
    }

    // Check for venv (dev builds)
    const venvPython = path.join(repo, ".venv", "bin", "python")
    if (fs.existsSync(venvPython)) return venvPython

    // Fallback to system
    return "python3"
  },

  /**
   * Get PYTHONPATH for Stanley dependencies
   */
  pythonPath(): string | undefined {
    const repo = this.repo()
    const bundledDeps = path.join(repo, ".python")
    if (fs.existsSync(bundledDeps)) return bundledDeps
    return process.env.STANLEY_PYTHONPATH
  },

  portfolioFile(): string {
    return process.env.STANLEY_PORTFOLIO_FILE || path.join(os.homedir(), ".zee", "stanley", "portfolio.json")
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
   * Zee data directory - ~/.zee/
   * Contains credentials, sessions, and persona data
   */
  dataDir(): string {
    return path.join(os.homedir(), ".zee")
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
