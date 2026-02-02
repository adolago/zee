/**
 * Centralized Path Resolution
 *
 * All persona and asset paths are resolved from AGENT_CORE_ROOT.
 * No need for env vars like STANLEY_REPO, ZEE_REPO, etc.
 */

import path from "path"
import fs from "fs"
import os from "os"

function findAgentCoreRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir)
  for (;;) {
    const packageRoot = path.join(current, "packages", "agent-core")
    const agentCoreDir = path.join(current, ".agent-core")
    if (fs.existsSync(packageRoot) || fs.existsSync(agentCoreDir)) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Get the agent-core root directory.
 * Order of precedence:
 * 1. AGENT_CORE_ROOT env var (set by binary or launcher)
 * 2. AGENT_CORE_SOURCE/OPENCODE_SOURCE env vars (backward compat)
 * 3. Walk up from cwd/argv/exec paths
 */
export function getAgentCoreRoot(): string {
  if (process.env.AGENT_CORE_ROOT || process.env.OPENCODE_ROOT) {
    return (process.env.AGENT_CORE_ROOT || process.env.OPENCODE_ROOT)!
  }

  const envSource = process.env.AGENT_CORE_SOURCE || process.env.OPENCODE_SOURCE
  if (envSource) return envSource

  const starts = [process.cwd()]
  const argvPath = process.argv[1]
  if (argvPath) starts.push(path.dirname(path.resolve(argvPath)))
  starts.push(path.dirname(process.execPath))

  for (const start of starts) {
    const root = findAgentCoreRoot(start)
    if (root) return root
  }

  return process.cwd()
}

/**
 * Persona paths - resolved from AGENT_CORE_ROOT/packages/personas/
 */
export const Personas = {
  root(): string {
    return path.join(getAgentCoreRoot(), "packages", "personas")
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
 * Tiara orchestration paths
 */
export const Tiara = {
  root(): string {
    return path.join(getAgentCoreRoot(), "packages", "tiara")
  },

  exists(): boolean {
    return fs.existsSync(this.root())
  },
}

/**
 * Agent-core assets paths
 */
export const Assets = {
  root(): string {
    return path.join(getAgentCoreRoot(), ".agent-core")
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
    return path.join(this.root(), "agent-core.jsonc")
  },
}
