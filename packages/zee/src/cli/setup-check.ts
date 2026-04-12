/**
 * Daemon Setup Check
 *
 * Validates required infrastructure and credentials on daemon startup.
 * Provides clear error messages for common setup issues.
 */

import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import os from "os"

import { CONFIG_FILE_NAMES, CONFIG_DIR_NAMES, getGlobalConfigDir } from "@root/config/defaults"
import { interpolate } from "@root/config/interpolation"
import { probeOpenBBAvailability, resolveOpenBBRuntime, type OpenBBRuntimeMode } from "../openbb/runtime"
import { getLocalMemoryStatus } from "../../../../src/memory/local-runtime"
import { Auth } from "../auth"
import { Config } from "../config/config"
import { ModelsDev } from "../provider/models"

const log = Log.create({ service: "setup-check" })

export interface SetupCheckResult {
  ok: boolean
  strict: boolean
  memory: {
    available: boolean
    prepared: boolean
    scope: "user" | "machine"
    vectorDbPath: string
    ftsDbPath: string
    embeddingModel: string
    embeddingDimensions: number
    error?: string
  }
  openbb: {
    available: boolean
    apiUrl: string
    mode: OpenBBRuntimeMode
    error?: string
    action?: string
  }
  agentProvider: AgentProviderSetupStatus
  warnings: string[]
  errors: string[]
}

const CONFIG_DISPLAY_MAX = 3
const REMOVED_AGENT_PROVIDER_IDS = new Set(["kernel", "voyage", "splitwise", "gemini-cli"])
const AGENT_PROVIDER_PRIORITY = [
  "google-antigravity",
  "google",
  "anthropic",
  "openai",
  "openrouter",
  "zai-coding-plan",
  "minimax-coding-plan",
  "kimi-for-coding",
  "minimax",
  "xai",
  "groq",
  "mistral",
  "deepinfra",
  "cohere",
  "togetherai",
  "perplexity",
  "azure",
  "ollama",
  "lmstudio",
  "llamacpp",
  "vllm",
  "tgi",
] as const

const FALLBACK_PROVIDER_ENV_KEYS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
  "google-antigravity": ["GOOGLE_ANTIGRAVITY_ACCESS_TOKEN"],
  openrouter: ["OPENROUTER_API_KEY"],
  "zai-coding-plan": ["ZAI_API_KEY", "ZHIPUAI_API_KEY"],
  "minimax-coding-plan": ["MINIMAX_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "kimi-for-coding": ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  xai: ["XAI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  deepinfra: ["DEEPINFRA_API_KEY"],
  cohere: ["COHERE_API_KEY"],
  togetherai: ["TOGETHER_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  azure: ["AZURE_OPENAI_API_KEY"],
}

export interface AgentProviderSetupStatus {
  available: boolean
  providerId?: string
  source?: "auth" | "env" | "config"
  action?: string
}

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
    const locations = Array.from(files).slice(0, CONFIG_DISPLAY_MAX).map(formatConfigPath)
    const suffix = files.size > CONFIG_DISPLAY_MAX ? ` (+${files.size - CONFIG_DISPLAY_MAX} more)` : ""
    const locationText = locations.length > 0 ? ` in ${locations.join(", ")}${suffix}` : ""
    warnings.push(`Missing env var ${name}${locationText}`)
  }

  return warnings
}

function readConfigProviderAuth(providerConfig: unknown): boolean {
  if (!providerConfig || typeof providerConfig !== "object") return false
  const record = providerConfig as Record<string, unknown>
  const options = record.options && typeof record.options === "object" ? (record.options as Record<string, unknown>) : {}
  const apiKey = options.apiKey
  if (typeof apiKey === "string" && apiKey.trim()) return true
  const baseURL = options.baseURL ?? record.api
  if (typeof baseURL === "string" && baseURL.trim()) return true
  return false
}

export async function checkAgentProviderReady(): Promise<AgentProviderSetupStatus> {
  const [auth, config, models] = await Promise.all([
    Auth.all().catch(() => ({})),
    Config.get().catch(() => undefined),
    ModelsDev.get().catch(() => ({})),
  ])

  const modelProviderIds = new Set(
    Object.entries(models)
      .filter(([id, provider]) => !REMOVED_AGENT_PROVIDER_IDS.has(id) && Object.keys(provider.models ?? {}).length > 0)
      .map(([id]) => id),
  )

  const configProviders = Object.keys(config?.provider ?? {})
  const authProviders = Object.keys(auth)
  const candidates = [
    ...AGENT_PROVIDER_PRIORITY,
    ...configProviders,
    ...authProviders,
    ...modelProviderIds,
  ].filter((id, index, all) => all.indexOf(id) === index && !REMOVED_AGENT_PROVIDER_IDS.has(id))

  for (const providerId of candidates) {
    if (!modelProviderIds.has(providerId) && !configProviders.includes(providerId) && !authProviders.includes(providerId)) {
      continue
    }

    if (auth[providerId]) {
      return { available: true, providerId, source: "auth" }
    }

    const envKeys = models[providerId]?.env ?? FALLBACK_PROVIDER_ENV_KEYS[providerId] ?? []
    if (envKeys.some((key) => Boolean(process.env[key]?.trim()))) {
      return { available: true, providerId, source: "env" }
    }

    const providerConfig = (config?.provider as Record<string, unknown> | undefined)?.[providerId]
    if (readConfigProviderAuth(providerConfig)) {
      return { available: true, providerId, source: "config" }
    }
  }

  return {
    available: false,
    action:
      "Configure at least one LLM provider, for example: zee auth login google-antigravity, zee auth login google, zee auth login anthropic, or zee auth login openai.",
  }
}

/**
 * Run all setup checks and return results
 */
export async function runSetupCheck(): Promise<SetupCheckResult> {
  const warnings: string[] = []
  const errors: string[] = []
  const strict = process.env.ZEE_STRICT_SETUP === "1" || process.env.ZEE_REQUIRE_MEMORY === "1"

  const memoryStatus = await getLocalMemoryStatus()
  const openbbResolution = resolveOpenBBRuntime()
  const openbbCheck = await probeOpenBBAvailability()
  const agentProvider = await checkAgentProviderReady()
  const missingEnvWarnings = await scanMissingEnvPlaceholders().catch(() => [])

  if (!memoryStatus.ok) {
    const detail = memoryStatus.sqlite.error || memoryStatus.embedding.error || "run `zee memory prepare`"
    const message = `Local memory is not prepared: ${detail}`
    if (strict) {
      errors.push(message)
      errors.push("  Run: zee memory prepare")
    } else {
      warnings.push(message)
    }
  }

  if (missingEnvWarnings.length > 0) {
    warnings.push(...missingEnvWarnings)
  }

  if (!openbbCheck.available) {
    warnings.push(`OpenBB Platform API unavailable at ${openbbResolution.apiUrl}`)
    if (openbbCheck.error) warnings.push(`OpenBB detail: ${openbbCheck.error}`)
    if (openbbCheck.action) warnings.push(`OpenBB remediation: ${openbbCheck.action}`)
  }

  if (!agentProvider.available) {
    const message = "No usable LLM provider is configured for agent runs."
    if (strict) {
      errors.push(message)
      if (agentProvider.action) errors.push(`  ${agentProvider.action}`)
    } else {
      warnings.push(message)
      if (agentProvider.action) warnings.push(agentProvider.action)
    }
  }

  const ok = strict ? memoryStatus.ok && agentProvider.available : true

  const result: SetupCheckResult = {
    ok,
    strict,
    memory: {
      available: memoryStatus.ok,
      prepared: memoryStatus.prepared,
      scope: memoryStatus.scope,
      vectorDbPath: memoryStatus.sqlite.vectorDbPath,
      ftsDbPath: memoryStatus.sqlite.ftsDbPath,
      embeddingModel: memoryStatus.embedding.model,
      embeddingDimensions: memoryStatus.embedding.dimensions,
      error: memoryStatus.sqlite.error || memoryStatus.embedding.error,
    },
    openbb: {
      available: openbbCheck.available,
      apiUrl: openbbResolution.apiUrl,
      mode: openbbResolution.mode,
      error: openbbCheck.error,
      action: openbbCheck.action,
    },
    agentProvider,
    warnings,
    errors,
  }

  if (ok) {
    log.info("Setup check passed", {
      memoryPrepared: memoryStatus.prepared,
      openbbAvailable: openbbCheck.available,
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

  // Memory status
  if (result.memory.available) {
    lines.push(`Memory:   OK (${result.memory.embeddingModel}, ${result.memory.embeddingDimensions} dims)`)
    lines.push(`          ${result.memory.vectorDbPath}`)
  } else {
    lines.push("Memory:   MISSING (local SQLite/embedding preparation)")
    if (result.memory.error) lines.push(`          ${result.memory.error}`)
    lines.push("          Run: zee memory prepare")
  }

  if (result.openbb.available) {
    lines.push(`OpenBB:   OK (${result.openbb.apiUrl}, ${result.openbb.mode})`)
  } else {
    lines.push(`OpenBB:   DEGRADED (${result.openbb.apiUrl}, ${result.openbb.mode})`)
    if (result.openbb.error) {
      lines.push(`          ${result.openbb.error}`)
    }
  }

  if (result.agentProvider.available) {
    lines.push(`Provider: OK (${result.agentProvider.providerId}, ${result.agentProvider.source})`)
  } else {
    lines.push("Provider: MISSING (no configured LLM provider)")
    if (result.agentProvider.action) lines.push(`          ${result.agentProvider.action}`)
  }

  lines.push("")

  // Summary
  if (result.ok) {
    lines.push(result.strict ? "Status: Ready" : "Status: Ready (degraded services are optional)")
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
export async function validateSetup(
  options: {
    exitOnFail?: boolean
    verbose?: boolean
  } = {},
): Promise<SetupCheckResult> {
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
