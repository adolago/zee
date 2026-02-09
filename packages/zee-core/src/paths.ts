/**
 * Centralized Path Resolution
 *
 * All persona and asset paths are resolved from ZEE_ROOT.
 * No need for env vars like STANLEY_REPO, ZEE_REPO, etc.
 */

import path from "path"
import fs from "fs"
import os from "os"

function findZeeRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir)
  for (;;) {
    const packageRoot = path.join(current, "packages", "zee-core")
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
 * 2. ZEE_SOURCE/AGENT_CORE_SOURCE/OPENCODE_SOURCE env vars (backward compat)
 * 3. Walk up from cwd/argv/exec paths
 */
export function getZeeRoot(): string {
  if (process.env.ZEE_ROOT || process.env.AGENT_CORE_ROOT || process.env.OPENCODE_ROOT) {
    return (process.env.ZEE_ROOT || process.env.AGENT_CORE_ROOT || process.env.OPENCODE_ROOT)!
  }

  const envSource = process.env.ZEE_SOURCE || process.env.AGENT_CORE_SOURCE || process.env.OPENCODE_SOURCE
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
 * Agent-core assets paths
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
