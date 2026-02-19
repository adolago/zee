#!/usr/bin/env bun
/**
 * Provider Health Check Script
 *
 * Tests all configured providers and models with minimal (1-token) requests.
 * Reports success, errors, and latency for each provider/model combination.
 *
 * Error Categories:
 * - AuthError: Invalid API key, expired token, unauthorized
 * - RateLimitError: Rate limited, too many requests (429)
 * - QuotaError: Insufficient balance, quota exceeded, billing issues
 * - TimeoutError: Connection timeout, slow response
 * - ModelNotFoundError: Model doesn't exist, deprecated
 * - ServerError: 5xx errors, internal server errors
 * - PermissionError: 403 forbidden, insufficient scopes
 * - ValidationError: Bad request, invalid parameters
 * - NetworkError: Connection refused, DNS errors
 *
 * Usage:
 *   bun run script/provider-health-check.ts
 *   bun run script/provider-health-check.ts --all           # Test all models
 *   bun run script/provider-health-check.ts --json          # Output JSON results
 *   bun run script/provider-health-check.ts --provider <id> # Test specific provider
 *   bun run script/provider-health-check.ts --errors-only   # Only show failing tests
 *   bun run script/provider-health-check.ts --critical-only # Only exit(1) if agent model provider fails
 *   bun run script/provider-health-check.ts --timeout 60    # Custom timeout (seconds)
 */

import { Provider } from "../src/provider/provider"
import { ProviderTransform } from "../src/provider/transform"
import { Config } from "../src/config/config"
import { generateText, streamText, type LanguageModel } from "ai"
import { Instance } from "../src/project/instance"

type TestStatus = "success" | "error" | "skipped" | "warning"

type ErrorCategory =
  | "AuthError"
  | "RateLimitError"
  | "QuotaError"
  | "TimeoutError"
  | "ModelNotFoundError"
  | "ServerError"
  | "PermissionError"
  | "ValidationError"
  | "NetworkError"
  | "ConfigError"
  | "UnknownError"

interface TestResult {
  provider: string
  model: string
  status: TestStatus
  error?: string
  errorType?: ErrorCategory
  latencyMs?: number
  response?: string
  timestamp: string
  suggestedAction?: string
}

const args = process.argv.slice(2)
const testAllModels = args.includes("--all")
const outputJson = args.includes("--json")
const errorsOnly = args.includes("--errors-only")
const criticalOnly = args.includes("--critical-only")
const providerArgIdx = args.indexOf("--provider")
const specificProvider =
  args.find((a) => a.startsWith("--provider="))?.split("=")[1] ??
  (providerArgIdx >= 0 ? args[providerArgIdx + 1] : undefined)
const timeoutArg = args.find((a) => a.startsWith("--timeout="))?.split("=")[1]
const DEFAULT_TIMEOUT = timeoutArg ? parseInt(timeoutArg, 10) * 1000 : 30000

// ANSI color codes for terminal output
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
}

async function testModel(
  providerID: string,
  providerInfo: Provider.Info,
  modelID: string,
  model: Provider.Model,
): Promise<TestResult> {
  const startTime = Date.now()

  try {
    // Check if provider is disabled
    const isDisabled = providerInfo.source === undefined

    // Check if provider has required authentication
    if (!providerInfo.source) {
      return {
        provider: providerID,
        model: modelID,
        status: "skipped",
        error: `No auth configured (need: ${providerInfo.env.join(" or ")})`,
        timestamp: new Date().toISOString(),
        suggestedAction: `Run: zee auth login ${providerID}`,
      }
    }

    // Get the language model
    let language: LanguageModel
    try {
      language = await Provider.getLanguage(model)
    } catch (e: unknown) {
      const err = e as Error
      return {
        provider: providerID,
        model: modelID,
        status: "error",
        error: err.message,
        errorType: (err.name as ErrorCategory) || "ConfigError",
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        suggestedAction: `Check provider configuration for ${providerID}`,
      }
    }

    // Build provider options
    const options = ProviderTransform.options({
      model,
      sessionID: "health-check",
      providerOptions: providerInfo.options,
    })

    // Check if model requires streaming (e.g., OpenAI codex models)
    const requiresStreaming = modelID.includes("codex") || model.api.id.includes("codex")

    let responseText: string

    if (requiresStreaming) {
      // Use streaming for models that require it
      const { text } = await streamText({
        model: language,
        prompt: "Reply with a single word: pong",
        temperature: 0,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        providerOptions: ProviderTransform.providerOptions(model, options),
        headers: model.headers,
      })
      responseText = await text
    } else {
      // Use non-streaming for other models
      const result = await generateText({
        model: language,
        prompt: "Reply with a single word: pong",
        temperature: 0,
        maxOutputTokens: 5,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        providerOptions: ProviderTransform.providerOptions(model, options),
        headers: model.headers,
      })
      responseText = result.text
    }

    const latencyMs = Date.now() - startTime

    return {
      provider: providerID,
      model: modelID,
      status: "success",
      latencyMs,
      response: responseText?.substring(0, 50),
      timestamp: new Date().toISOString(),
    }
  } catch (e: unknown) {
    const err = e as Error & { cause?: Error; data?: unknown; responseBody?: string; url?: string; statusCode?: number }
    const latencyMs = Date.now() - startTime

    // Categorize error types for better diagnostics
    const errorType = categorizeError(err)

    // Extract detailed error info
    let errorDetails = err.message?.substring(0, 500) || String(e)
    if (err.cause) {
      errorDetails += ` | Cause: ${err.cause.message}`
    }
    if (err.data) {
      errorDetails += ` | Data: ${JSON.stringify(err.data).substring(0, 200)}`
    }
    if (err.responseBody) {
      errorDetails += ` | Response: ${err.responseBody.substring(0, 200)}`
    }
    if (err.statusCode) {
      errorDetails += ` | Status: ${err.statusCode}`
    }

    const suggestedAction = getSuggestedAction(errorType, providerID)

    return {
      provider: providerID,
      model: modelID,
      status: "error",
      error: errorDetails,
      errorType,
      latencyMs,
      timestamp: new Date().toISOString(),
      suggestedAction,
    }
  }
}

function categorizeError(err: Error & { statusCode?: number; code?: string }): ErrorCategory {
  const message = err.message?.toLowerCase() || ""
  const name = err.name || ""
  const statusCode = err.statusCode
  const code = typeof err.code === "string" ? err.code.toLowerCase() : ""

  // Check HTTP status codes first
  if (statusCode === 401 || statusCode === 403) {
    return "PermissionError"
  }
  if (statusCode === 429) {
    return "RateLimitError"
  }
  if (statusCode === 404) {
    return "ModelNotFoundError"
  }
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return "ServerError"
  }
  if (statusCode === 400) {
    return "ValidationError"
  }

  // Check error messages
  if (
    message.includes("unauthorized") ||
    message.includes("authentication") ||
    message.includes("api key") ||
    message.includes("invalid_api_key") ||
    message.includes("invalid token")
  ) {
    return "AuthError"
  }
  if (message.includes("rate limit") || message.includes("too many requests") || message.includes("throttled")) {
    return "RateLimitError"
  }
  if (
    message.includes("quota") ||
    message.includes("billing") ||
    message.includes("insufficient") ||
    message.includes("credit") ||
    message.includes("balance") ||
    message.includes("exceeded your current quota")
  ) {
    return "QuotaError"
  }
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("etimedout") ||
    message.includes("abort") ||
    code === "etimedout"
  ) {
    return "TimeoutError"
  }
  if (
    message.includes("not found") ||
    message.includes("model not found") ||
    message.includes("does not exist") ||
    message.includes("unknown model")
  ) {
    return "ModelNotFoundError"
  }
  if (
    message.includes("server error") ||
    message.includes("internal error") ||
    message.includes("bad gateway") ||
    message.includes("service unavailable")
  ) {
    return "ServerError"
  }
  if (
    message.includes("permission") ||
    message.includes("forbidden") ||
    message.includes("insufficient scopes") ||
    message.includes("access denied")
  ) {
    return "PermissionError"
  }
  if (
    message.includes("invalid") ||
    message.includes("bad request") ||
    message.includes("validation") ||
    message.includes("unsupported parameter")
  ) {
    return "ValidationError"
  }
  if (
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    code === "econnrefused" ||
    code === "enotfound"
  ) {
    return "NetworkError"
  }
  if (message.includes("config") || message.includes("configuration")) {
    return "ConfigError"
  }

  return (name as ErrorCategory) || "UnknownError"
}

function getSuggestedAction(errorType: ErrorCategory, provider: string): string {
  const actions: Record<ErrorCategory, string> = {
    AuthError: `Run: zee auth login ${provider}`,
    RateLimitError: "Wait and retry; consider reducing request frequency",
    QuotaError: "Check billing dashboard; add credits or upgrade plan",
    TimeoutError: "Check network connection; retry with longer timeout",
    ModelNotFoundError: "Model may be deprecated; check models.dev for alternatives",
    ServerError: "Provider issue; retry later or check provider status page",
    PermissionError: `Re-authenticate: zee auth login ${provider}`,
    ValidationError: "Check model parameters; may need config update",
    NetworkError: "Check internet connection and DNS resolution",
    ConfigError: "Verify provider configuration in zee.jsonc",
    UnknownError: "Check logs for details; may need manual investigation",
  }
  return actions[errorType] || actions.UnknownError
}

async function main() {
  const results: TestResult[] = []
  let config: Awaited<ReturnType<typeof Config.get>> | undefined

  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      config = await Config.get()
      const allProviders = await Provider.list()
      const providerList = specificProvider
        ? Object.entries(allProviders).filter(([id]) => id === specificProvider)
        : Object.entries(allProviders)

      if (!outputJson) {
        console.log(`\nProvider Health Check`)
        console.log(`${"=".repeat(60)}`)
        console.log(
          `Found ${providerList.length} providers${specificProvider ? ` (filtered to: ${specificProvider})` : ""}`,
        )
        console.log(`Mode: ${testAllModels ? "Testing ALL models" : "Testing first model per provider"}`)
        console.log(`${"=".repeat(60)}\n`)
      }

      for (const [providerID, providerInfo] of providerList) {
        const modelList = Object.entries(providerInfo.models)
        // Filter out deprecated models and embedding models (which don't support chat)
        const isEmbeddingModel = (id: string) => id.includes("embedding") || id.includes("embed")

        // For google provider, separate antigravity models from native models
        const isAntigravityModel = (id: string) => id.includes("antigravity")

        let testableModels: typeof modelList
        if (providerID === "google") {
          // Check if we have antigravity models - if so, prioritize testing one of those
          const antigravityModels = modelList.filter(([id]) => isAntigravityModel(id))
          const nativeModels = modelList.filter(
            ([id, model]) => !isAntigravityModel(id) && model.status !== "deprecated" && !isEmbeddingModel(id),
          )

          if (testAllModels) {
            testableModels = [...antigravityModels, ...nativeModels]
          } else {
            // Test one antigravity model (if available) and one native model
            // Prefer lightest models for health checks: flash > non-thinking > thinking
            const sortAntigravity = (models: typeof modelList) =>
              models.sort(([idA, a], [idB, b]) => {
                const weight = (id: string) => {
                  if (id.includes("flash")) return 0
                  if (id.includes("thinking")) return 2
                  return 1
                }
                const diff = weight(idA) - weight(idB)
                if (diff !== 0) return diff
                return (a.cost.input || 0) - (b.cost.input || 0)
              })
            const sortedNative = nativeModels.sort(([, a], [, b]) => (a.cost.input || 0) - (b.cost.input || 0))
            testableModels = [...sortAntigravity(antigravityModels).slice(0, 1), ...sortedNative.slice(0, 1)]
          }

          if (!outputJson && antigravityModels.length > 0) {
            console.log(`  Antigravity models: ${antigravityModels.length}`)
            console.log(`  Native Gemini models: ${nativeModels.length}`)
          }
        } else {
          const eligible = modelList.filter(([id, model]) => model.status !== "deprecated" && !isEmbeddingModel(id))
          if (testAllModels) {
            testableModels = eligible
          } else {
            // Prefer free models for single-model health checks to avoid billing errors
            const sorted = eligible.sort(([, a], [, b]) => (a.cost.input || 0) - (b.cost.input || 0))
            testableModels = sorted.slice(0, 1)
          }
        }

        if (!outputJson) {
          console.log(`\n${providerID} (${testableModels.length}/${modelList.length} models)`)
          console.log(`  Source: ${providerInfo.source || "none"}`)
          console.log(`  Env: ${providerInfo.env.join(", ")}`)
        }

        for (const [modelID, model] of testableModels) {
          if (!outputJson) {
            process.stdout.write(`  Testing ${modelID}...`)
          }

          const result = await testModel(providerID, providerInfo, modelID, model)
          results.push(result)

          if (!outputJson && (!errorsOnly || result.status === "error")) {
            const color =
              result.status === "success" ? COLORS.green : result.status === "skipped" ? COLORS.yellow : COLORS.red
            const statusIcon = result.status === "success" ? "OK" : result.status === "skipped" ? "SKIP" : "FAIL"
            const latency = result.latencyMs ? ` (${result.latencyMs}ms)` : ""
            console.log(`${color}[${statusIcon}]${COLORS.reset}${latency}`)
            if (result.error && result.status === "error") {
              console.log(`    ${COLORS.red}${result.errorType}:${COLORS.reset} ${result.error?.substring(0, 80)}...`)
              if (result.suggestedAction) {
                console.log(`    ${COLORS.cyan}Action: ${result.suggestedAction}${COLORS.reset}`)
              }
            }
          }
        }
      }
    },
  })

  // Output results
  if (outputJson) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  // Summary
  const successful = results.filter((r) => r.status === "success")
  const failed = results.filter((r) => r.status === "error")
  const skipped = results.filter((r) => r.status === "skipped")

  console.log(`\n${COLORS.bold}${"=".repeat(60)}${COLORS.reset}`)
  console.log(`${COLORS.bold}SUMMARY${COLORS.reset}`)
  console.log(`${COLORS.bold}${"=".repeat(60)}${COLORS.reset}`)
  console.log(
    `${COLORS.bold}Total:${COLORS.reset} ${results.length} | ${COLORS.green}OK: ${successful.length}${COLORS.reset} | ${COLORS.red}FAILED: ${failed.length}${COLORS.reset} | ${COLORS.yellow}SKIPPED: ${skipped.length}${COLORS.reset}`,
  )

  if (successful.length > 0 && !errorsOnly) {
    console.log(`\n${COLORS.green}SUCCESSFUL (${successful.length}):${COLORS.reset}`)
    for (const r of successful) {
      console.log(`  [OK] ${COLORS.green}${r.provider}/${r.model}${COLORS.reset} (${r.latencyMs}ms)`)
    }
  }

  if (failed.length > 0) {
    console.log(`\n${COLORS.red}FAILED (${failed.length}):${COLORS.reset}`)

    // Group by error type
    const byErrorType = new Map<ErrorCategory, TestResult[]>()
    for (const r of failed) {
      const type = r.errorType || "UnknownError"
      if (!byErrorType.has(type)) byErrorType.set(type, [])
      byErrorType.get(type)!.push(r)
    }

    for (const [errorType, errs] of byErrorType) {
      console.log(`\n  ${COLORS.red}${errorType}${COLORS.reset} (${errs.length}):`)
      for (const r of errs) {
        console.log(`    - ${r.provider}/${r.model}`)
        console.log(`      ${r.error?.substring(0, 80)}...`)
        if (r.suggestedAction) {
          console.log(`      ${COLORS.cyan}> ${r.suggestedAction}${COLORS.reset}`)
        }
      }
    }
  }

  if (skipped.length > 0) {
    console.log(`\n${COLORS.yellow}SKIPPED - Missing Auth (${skipped.length}):${COLORS.reset}`)
    const providers = new Set(skipped.map((r) => r.provider))
    for (const p of providers) {
      const first = skipped.find((r) => r.provider === p)
      console.log(`  - ${p}: ${first?.error}`)
      if (first?.suggestedAction) {
        console.log(`    ${COLORS.cyan}> ${first.suggestedAction}${COLORS.reset}`)
      }
    }
  }

  console.log(`\n${COLORS.bold}${"=".repeat(60)}${COLORS.reset}\n`)

  // Exit with error code if any failures
  if (failed.length > 0) {
    if (criticalOnly) {
      // In --critical-only mode, only exit(1) if the active agent model's provider failed.
      // Read agent model from config to determine the critical provider.
      if (!config) {
        console.log(`${COLORS.yellow}Could not determine critical provider (no config)${COLORS.reset}`)
        process.exit(1)
      }
      const defaultAgent = config.default_agent ?? "zee"
      const agentConfig = (config.agent as Record<string, { model?: string } | undefined>)?.[defaultAgent]
      const agentModel = agentConfig?.model
      const criticalProvider = agentModel?.split("/")[0]

      if (criticalProvider) {
        const criticalFailures = failed.filter((r) => r.provider === criticalProvider)
        if (criticalFailures.length > 0) {
          console.log(
            `${COLORS.red}${COLORS.bold}CRITICAL: Agent model provider "${criticalProvider}" failed${COLORS.reset}`,
          )
          process.exit(1)
        } else {
          console.log(
            `${COLORS.yellow}Non-critical provider failures (agent model provider "${criticalProvider}" is OK)${COLORS.reset}`,
          )
          process.exit(0)
        }
      }
      // If we can't determine the critical provider, fall through to exit(1)
    }
    process.exit(1)
  }

  // Explicit exit: Instance/Provider/Config leave async handles open
  process.exit(0)
}

main().catch((e) => {
  console.error("Fatal error:", e)
  process.exit(1)
})
