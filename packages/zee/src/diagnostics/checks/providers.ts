/**
 * @file Provider Checks
 * @description Network and AI provider connectivity checks
 */

import type { CheckResult, CheckOptions } from "../types"
import { Auth } from "../../auth"

interface ProviderConfig {
  name: string
  id: string
  endpoint: string
  envKey: string
  timeout: number
  authProviderId?: string
}

const PROVIDERS: ProviderConfig[] = [
  {
    name: "Anthropic",
    id: "anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    envKey: "ANTHROPIC_API_KEY",
    timeout: 5000,
    authProviderId: "anthropic",
  },
  {
    name: "OpenAI",
    id: "openai",
    endpoint: "https://api.openai.com/v1/models",
    envKey: "OPENAI_API_KEY",
    timeout: 5000,
    authProviderId: "openai",
  },
  {
    name: "Google Gemini",
    id: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1/models",
    envKey: "GOOGLE_API_KEY",
    timeout: 5000,
    authProviderId: "google",
  },
]

async function checkInternetConnectivity(): Promise<CheckResult> {
  const start = Date.now()
  const testUrls = ["https://dns.google/resolve?name=example.com", "https://cloudflare.com/cdn-cgi/trace"]

  for (const url of testUrls) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(controller.abort.bind(controller), 5000)
      const response = await fetch(url, { method: "HEAD", signal: controller.signal })
      clearTimeout(timeout)

      if (response.ok || response.status < 500) {
        return {
          id: "providers.internet",
          name: "Internet Connectivity",
          category: "providers",
          status: "pass",
          message: `Connected (${Date.now() - start}ms)`,
          severity: "info",
          durationMs: Date.now() - start,
          autoFixable: false,
        }
      }
    } catch {
      continue
    }
  }

  return {
    id: "providers.internet",
    name: "Internet Connectivity",
    category: "providers",
    status: "fail",
    message: "No internet connection",
    details: "Check your network connection",
    severity: "critical",
    durationMs: Date.now() - start,
    autoFixable: false,
  }
}

async function checkProvider(provider: ProviderConfig): Promise<CheckResult> {
  const start = Date.now()
  const envValue = process.env[provider.envKey]
  const hasEnv = Boolean(envValue && envValue.trim())
  let hasAuth = false

  if (provider.authProviderId) {
    const auth = await Auth.get(provider.authProviderId)
    if (auth?.type === "api") {
      hasAuth = Boolean(auth.key?.trim())
    } else if (auth?.type === "oauth") {
      hasAuth = Boolean(auth.access?.trim())
    } else if (auth?.type === "wellknown") {
      hasAuth = Boolean(auth.token?.trim())
    }
  }

  const isConfigured = hasEnv || hasAuth

  if (!isConfigured) {
    const details = provider.authProviderId
      ? `Run \`zee auth login ${provider.authProviderId}\` (or set ${provider.envKey})`
      : `Set ${provider.envKey} environment variable`
    return {
      id: `providers.${provider.id}`,
      name: provider.name,
      category: "providers",
      status: "skip",
      message: "Not configured",
      details,
      severity: "info",
      durationMs: Date.now() - start,
      autoFixable: false,
    }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(controller.abort.bind(controller), provider.timeout)
    const response = await fetch(provider.endpoint, { method: "HEAD", signal: controller.signal })
    clearTimeout(timeout)
    const latency = Date.now() - start
    const isReachable = [200, 204, 401, 403, 405].includes(response.status)

    return {
      id: `providers.${provider.id}`,
      name: provider.name,
      category: "providers",
      status: isReachable ? "pass" : "warn",
      message: isReachable ? `${latency}ms [reachable]` : `HTTP ${response.status}`,
      severity: isReachable ? "info" : "warning",
      durationMs: latency,
      autoFixable: false,
      metadata: { latencyMs: latency },
    }
  } catch (error) {
    const latency = Date.now() - start
    const isTimeout = error instanceof Error && error.name === "AbortError"
    return {
      id: `providers.${provider.id}`,
      name: provider.name,
      category: "providers",
      status: "fail",
      message: isTimeout ? "Timed out" : "Connection failed",
      details: error instanceof Error ? error.message : String(error),
      severity: "error",
      durationMs: latency,
      autoFixable: false,
    }
  }
}

async function checkOllama(): Promise<CheckResult> {
  const start = Date.now()
  const ollamaUrl = process.env.OLLAMA_HOST || "http://localhost:11434/api/tags"

  try {
    const controller = new AbortController()
    const timeout = setTimeout(controller.abort.bind(controller), 3000)
    const response = await fetch(ollamaUrl, { signal: controller.signal })
    clearTimeout(timeout)
    const latency = Date.now() - start

    if (response.ok) {
      const data = (await response.json()) as { models?: unknown[] }
      const modelCount = data.models?.length || 0
      return {
        id: "providers.ollama",
        name: "Ollama (Local)",
        category: "providers",
        status: "pass",
        message: `${modelCount} model(s) available (${latency}ms)`,
        severity: "info",
        durationMs: latency,
        autoFixable: false,
        metadata: { modelCount, latencyMs: latency },
      }
    }
    return {
      id: "providers.ollama",
      name: "Ollama (Local)",
      category: "providers",
      status: "warn",
      message: `HTTP ${response.status}`,
      severity: "warning",
      durationMs: latency,
      autoFixable: false,
    }
  } catch (error) {
    const latency = Date.now() - start
    const isConnection =
      error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"))
    return {
      id: "providers.ollama",
      name: "Ollama (Local)",
      category: "providers",
      status: isConnection ? "skip" : "warn",
      message: isConnection ? "Not running" : "Connection error",
      details: isConnection
        ? "Start Ollama with 'ollama serve'"
        : error instanceof Error
          ? error.message
          : String(error),
      severity: "info",
      durationMs: latency,
      autoFixable: false,
    }
  }
}

export async function runProviderChecks(options: CheckOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const internetResult = await checkInternetConnectivity()
  results.push(internetResult)

  if (internetResult.status === "fail") {
    return results
  }

  const providerResults = await Promise.all(PROVIDERS.map((p) => checkProvider(p)))
  results.push(...providerResults)
  results.push(await checkOllama())

  return results
}
