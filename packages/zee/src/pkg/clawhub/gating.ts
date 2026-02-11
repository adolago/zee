/**
 * ClawHub Skill Gating Evaluation
 *
 * Determines whether a skill's requirements (bins, env, config, os)
 * are satisfied on the current system before installation.
 */

import os from "os"
import { Config } from "../../config/config"
import type { ClawHubRequires } from "./types"

export interface GatingResult {
  ok: boolean
  issues: GatingIssue[]
}

export interface GatingIssue {
  kind: "bin" | "env" | "config" | "os"
  name: string
  message: string
}

/**
 * Check if a binary is available in PATH.
 */
async function isBinAvailable(bin: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "pipe" })
    const code = await proc.exited
    return code === 0
  } catch {
    return false
  }
}

/**
 * Evaluate whether a skill's requirements are met on this system.
 */
export async function evaluateGating(requires?: ClawHubRequires): Promise<GatingResult> {
  if (!requires) return { ok: true, issues: [] }

  const issues: GatingIssue[] = []

  // Check required binaries
  if (requires.bins) {
    for (const bin of requires.bins) {
      if (!(await isBinAvailable(bin))) {
        issues.push({
          kind: "bin",
          name: bin,
          message: `Required binary "${bin}" not found in PATH`,
        })
      }
    }
  }

  // Check required environment variables
  if (requires.env) {
    for (const envVar of requires.env) {
      if (!process.env[envVar]) {
        issues.push({
          kind: "env",
          name: envVar,
          message: `Required environment variable "${envVar}" is not set`,
        })
      }
    }
  }

  // Check required config keys
  if (requires.config) {
    try {
      const config = await Config.get()
      for (const key of requires.config) {
        const value = getNestedValue(config, key)
        if (value === undefined || value === null) {
          issues.push({
            kind: "config",
            name: key,
            message: `Required config key "${key}" is not set`,
          })
        }
      }
    } catch {
      // Config unavailable; skip config gating
    }
  }

  // Check OS compatibility
  if (requires.os && requires.os.length > 0) {
    const currentPlatform = os.platform()
    if (!requires.os.includes(currentPlatform)) {
      issues.push({
        kind: "os",
        name: currentPlatform,
        message: `Current OS "${currentPlatform}" not in supported list: ${requires.os.join(", ")}`,
      })
    }
  }

  return { ok: issues.length === 0, issues }
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".")
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}
