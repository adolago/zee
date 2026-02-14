/**
 * Daemon Setup Check
 *
 * Validates required infrastructure and credentials on daemon startup.
 * Provides clear error messages for common setup issues.
 */

import { Log } from "../util/log"
import { Global } from "../global"
import path from "path"
import fs from "fs/promises"
import net from "net"
import os from "os"

import { CONFIG_FILE_NAMES, CONFIG_DIR_NAMES, getGlobalConfigDir } from "@root/config/defaults"
import { interpolate } from "@root/config/interpolation"

const log = Log.create({ service: "setup-check" })

export interface SetupCheckResult {
  ok: boolean
  qdrant: {
    available: boolean
    url: string
    error?: string
  }
  googleApiKey: {
    available: boolean
    source?: "auth.json:data" | "auth.json:state" | "env:GOOGLE_API_KEY"
    error?: string
  }
  warnings: string[]
  errors: string[]
}

const AUTH_JSON_DATA_PATH = path.join(Global.Path.data, "auth.json")
const AUTH_JSON_STATE_PATH = path.join(Global.Path.state, "auth.json")
const CONFIG_DISPLAY_MAX = 3

async function findProjectConfigDirs(startDir: string): Promise<string[]> {
  const dirs: string[] = []
  let currentDir = startDir
  const root = path.parse(currentDir).root

  while (currentDir !== root) {
    for (const dirName of CONFIG_DIR_NAMES) {
      const configDir = path.join(currentDir, dirName)
      try {
        const stat = await fs.stat(configDir)
        if (stat.isDirectory()) {
          dirs.push(configDir)
        }
      } catch {
        // Directory doesn't exist
      }
    }

    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = path.join(currentDir, fileName)
      try {
        await fs.access(filePath)
        if (!dirs.includes(currentDir)) {
          dirs.push(currentDir)
        }
      } catch {
        // File doesn't exist
      }
    }

    const gitDir = path.join(currentDir, ".git")
    try {
      await fs.access(gitDir)
      break
    } catch {
      // Not a git repo - continue upward
    }

    if (currentDir === os.homedir()) {
      break
    }

    currentDir = path.dirname(currentDir)
  }

  return dirs.reverse()
}

function formatConfigPath(filePath: string): string {
  const home = os.homedir()
  if (filePath.startsWith(home)) {
    return filePath.replace(home, "~")
  }
  return filePath
}

async function scanMissingEnvPlaceholders(): Promise<string[]> {
  const warnings: string[] = []
  const missingByVar = new Map<string, Set<string>>()

  const globalDir = getGlobalConfigDir()
  const projectDirs = await findProjectConfigDirs(process.cwd())
  const scanDirs = [globalDir, ...projectDirs]

  for (const dir of scanDirs) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = path.join(dir, fileName)
      let text: string
      try {
        text = await fs.readFile(filePath, "utf-8")
      } catch {
        continue
      }

      const interpolated = await interpolate(text, {
        configDir: path.dirname(filePath),
        env: process.env,
        strict: false,
      })

      for (const missing of interpolated.missing) {
        if (missing.type !== "env") continue
        const list = missingByVar.get(missing.name) ?? new Set<string>()
        list.add(filePath)
        missingByVar.set(missing.name, list)
      }
    }
  }

  for (const [name, files] of missingByVar.entries()) {
    const locations = Array.from(files)
      .slice(0, CONFIG_DISPLAY_MAX)
      .map(formatConfigPath)
    const suffix = files.size > CONFIG_DISPLAY_MAX ? ` (+${files.size - CONFIG_DISPLAY_MAX} more)` : ""
    const locationText = locations.length > 0 ? ` in ${locations.join(", ")}${suffix}` : ""
    warnings.push(`Missing env var ${name}${locationText}`)
  }

  return warnings
}

/**
 * Check if Qdrant is reachable at the given URL
 */
async function checkQdrantConnectivity(url: string): Promise<{ available: boolean; error?: string }> {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    const port = Number.parseInt(parsed.port || "6333", 10)

    return new Promise((resolve) => {
      const socket = new net.Socket()
      const timeout = setTimeout(() => {
        socket.destroy()
        resolve({ available: false, error: "Connection timeout (3s)" })
      }, 3000)

      socket.once("connect", () => {
        clearTimeout(timeout)
        socket.end()
        resolve({ available: true })
      })

      socket.once("error", (err) => {
        clearTimeout(timeout)
        const code = (err as NodeJS.ErrnoException).code
        const errorMsg = code === "ECONNREFUSED"
          ? "Connection refused"
          : code === "ENOTFOUND"
            ? "Host not found"
            : err.message || code || "Connection failed"
        resolve({ available: false, error: errorMsg })
      })

      socket.connect(port, host)
    })
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Check if Google API key is available from the Zee auth store.
 */
async function checkGoogleApiKey(): Promise<{
  available: boolean
  source?: "auth.json:data" | "auth.json:state" | "env:GOOGLE_API_KEY"
  error?: string
}> {
  const envKey = process.env.GOOGLE_API_KEY?.trim()
  if (envKey) {
    return { available: true, source: "env:GOOGLE_API_KEY" }
  }

  const candidates: Array<{ source: "auth.json:data" | "auth.json:state"; path: string }> = [
    { source: "auth.json:data", path: AUTH_JSON_DATA_PATH },
    { source: "auth.json:state", path: AUTH_JSON_STATE_PATH },
  ]

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate.path, "utf-8")
      const auth = JSON.parse(content)
      const googleAuth = auth.google as
        | { type?: string; key?: string; refresh?: string; access?: string }
        | undefined

      const hasApiKey =
        googleAuth?.type === "api" && typeof googleAuth.key === "string" && googleAuth.key.trim()

      const hasOauthCredentials =
        googleAuth?.type === "oauth" &&
        ((typeof googleAuth.refresh === "string" && googleAuth.refresh.trim()) ||
          (typeof googleAuth.access === "string" && googleAuth.access.trim()))

      if (hasApiKey || hasOauthCredentials) {
        return { available: true, source: candidate.source }
      }
    } catch {
      // auth.json doesn't exist or can't be read
    }
  }

  return {
    available: false,
    error: "No Google API key found. Run `zee auth login google`",
  }
}

/**
 * Get the default Qdrant URL
 */
function getQdrantUrl(): string {
  const configUrl = process.env.QDRANT_URL?.trim()
  if (configUrl) return configUrl

  // Try to read from config file
  const configPath = path.join(Global.Path.config, "zee.jsonc")
  try {
    const content = require("fs").readFileSync(configPath, "utf-8")
    // Simple regex to extract qdrant URL - not full JSONC parser
    const match = content.match(/"qdrantUrl"\s*:\s*"([^"]+)"/)
    if (match?.[1]) return match[1]
  } catch {
    // Config file doesn't exist
  }

  return "http://localhost:6333"
}

/**
 * Run all setup checks and return results
 */
export async function runSetupCheck(): Promise<SetupCheckResult> {
  const warnings: string[] = []
  const errors: string[] = []

  const qdrantUrl = getQdrantUrl()
  const qdrantCheck = await checkQdrantConnectivity(qdrantUrl)
  const googleCheck = await checkGoogleApiKey()
  const missingEnvWarnings = await scanMissingEnvPlaceholders().catch(() => [])

  if (!qdrantCheck.available) {
    errors.push(`Qdrant not available at ${qdrantUrl}: ${qdrantCheck.error}`)
    errors.push("  Run: docker compose up -d   OR   zee setup")
  }

  if (!googleCheck.available) {
    errors.push("Google API key not found (required for memory embeddings, regardless of chat provider)")
    errors.push("  Run: zee auth login google")
    errors.push(`  Stores in: ${AUTH_JSON_DATA_PATH} (or ${AUTH_JSON_STATE_PATH})`)
  }

  if (missingEnvWarnings.length > 0) {
    warnings.push(...missingEnvWarnings)
  }

  const ok = qdrantCheck.available && googleCheck.available

  const result: SetupCheckResult = {
    ok,
    qdrant: {
      available: qdrantCheck.available,
      url: qdrantUrl,
      error: qdrantCheck.error,
    },
    googleApiKey: {
      available: googleCheck.available,
      source: googleCheck.source,
      error: googleCheck.error,
    },
    warnings,
    errors,
  }

  if (ok) {
    log.info("Setup check passed", {
      qdrantUrl,
      googleSource: googleCheck.source,
      warnings: warnings.length,
    })
  } else {
    log.warn("Setup check failed", { errors })
  }

  return result
}

/**
 * Format setup check result for console output
 */
export function formatSetupCheckResult(result: SetupCheckResult): string {
  const lines: string[] = []

  lines.push("Setup Check")
  lines.push("===========")

  // Qdrant status
  if (result.qdrant.available) {
    lines.push(`Qdrant:   OK (${result.qdrant.url})`)
  } else {
    lines.push(`Qdrant:   MISSING (${result.qdrant.url})`)
    lines.push(`          ${result.qdrant.error}`)
  }

  // Google API key status
  if (result.googleApiKey.available) {
    lines.push(`Google:   OK (${result.googleApiKey.source})`)
  } else {
    lines.push("Google:   MISSING (API key for memory embeddings)")
  }

  lines.push("")

  // Summary
  if (result.ok) {
    lines.push("Status: Ready")
  } else {
    lines.push("Status: Setup required")
    lines.push("")
    for (const error of result.errors) {
      lines.push(error)
    }
  }

  if (result.warnings.length > 0) {
    lines.push("")
    lines.push("Warnings:")
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`)
    }
  }

  return lines.join("\n")
}

/**
 * Run setup check and optionally exit if failed
 *
 * @param exitOnFail - If true, exit process on failure (default: false for graceful degradation)
 * @param verbose - If true, always print status (default: only on failure)
 */
export async function validateSetup(options: {
  exitOnFail?: boolean
  verbose?: boolean
} = {}): Promise<SetupCheckResult> {
  const result = await runSetupCheck()

  if (!result.ok || options.verbose) {
    console.log("")
    console.log(formatSetupCheckResult(result))
    console.log("")
  }

  if (!result.ok && options.exitOnFail) {
    process.exit(1)
  }

  return result
}
