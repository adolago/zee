#!/usr/bin/env bun
/**
 * Provider Health Check Script
 *
 * Tests all configured providers and models with minimal (1-token) requests.
 * Reports success, errors, and latency for each provider/model combination.
 *
 * Usage:
 *   bun run script/provider-health-check.ts
 *   bun run script/provider-health-check.ts --all     # Test all models, not just first per provider
 *   bun run script/provider-health-check.ts --json    # Output JSON results
 *   bun run script/provider-health-check.ts --provider anthropic  # Test specific provider
 */

import { Provider } from "../src/provider/provider"
import { ProviderTransform } from "../src/provider/transform"
import { generateText, streamText, type LanguageModel } from "ai"
import { Instance } from "../src/project/instance"

interface TestResult {
  provider: string
  model: string
  status: "success" | "error" | "skipped"
  error?: string
  errorType?: string
  latencyMs?: number
  response?: string
}

const args = process.argv.slice(2)
const testAllModels = args.includes("--all")
const outputJson = args.includes("--json")
const specificProvider = args.find((a) => a.startsWith("--provider="))?.split("=")[1] ?? args[args.indexOf("--provider") + 1]

async function testModel(
  providerID: string,
  providerInfo: Provider.Info,
  modelID: string,
  model: Provider.Model,
): Promise<TestResult> {
  const startTime = Date.now()

  try {
    // Check if provider has required authentication
    if (!providerInfo.source || (providerInfo.source as unknown) === "none") {
      return {
        provider: providerID,
        model: modelID,
        status: "skipped",
        error: `No auth configured (need: ${providerInfo.env.join(" or ")})`,
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
        errorType: err.name || "LanguageModelError",
        latencyMs: Date.now() - startTime,
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
        abortSignal: AbortSignal.timeout(30000),
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
        abortSignal: AbortSignal.timeout(30000),
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

    return {
      provider: providerID,
      model: modelID,
      status: "error",
      error: errorDetails,
      errorType,
      latencyMs,
    }
  }
}

function categorizeError(err: Error): string {
  const message = err.message?.toLowerCase() || ""
  const name = err.name || ""

  if (message.includes("unauthorized") || message.includes("authentication") || message.includes("api key") || message.includes("invalid_api_key")) {
    return "AuthError"
  }
  if (message.includes("rate limit") || message.includes("too many requests") || message.includes("429")) {
    return "RateLimitError"
  }
  if (message.includes("timeout") || message.includes("timed out") || message.includes("econnrefused") || message.includes("abort")) {
    return "TimeoutError"
  }
  if (message.includes("not found") || message.includes("404") || message.includes("model not found") || message.includes("does not exist")) {
    return "ModelNotFoundError"
  }
  if (message.includes("quota") || message.includes("billing") || message.includes("insufficient") || message.includes("credit")) {
    return "QuotaError"
  }
  if (message.includes("invalid") || message.includes("bad request") || message.includes("400")) {
    return "ValidationError"
  }
  if (message.includes("server error") || message.includes("500") || message.includes("502") || message.includes("503") || message.includes("internal")) {
    return "ServerError"
  }
  if (message.includes("permission") || message.includes("forbidden") || message.includes("403")) {
    return "PermissionError"
  }

  return name || "UnknownError"
}

async function main() {
  const results: TestResult[] = []

  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      const allProviders = await Provider.list()
      const providerList = specificProvider
        ? Object.entries(allProviders).filter(([id]) => id === specificProvider)
        : Object.entries(allProviders)

      if (!outputJson) {
        console.log(`\nProvider Health Check`)
        console.log(`${"=".repeat(60)}`)
        console.log(`Found ${providerList.length} providers${specificProvider ? ` (filtered to: ${specificProvider})` : ""}`)
        console.log(`Mode: ${testAllModels ? "Testing ALL models" : "Testing first model per provider"}`)
        console.log(`${"=".repeat(60)}\n`)
      }

      for (const [providerID, providerInfo] of providerList) {
        const modelList = Object.entries(providerInfo.models)
        const testableModels = testAllModels
          ? modelList.filter(([_, model]) => model.status !== "deprecated")
          : modelList.filter(([_, model]) => model.status !== "deprecated").slice(0, 1)

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

          if (!outputJson) {
            const statusIcon = result.status === "success" ? "OK" : result.status === "skipped" ? "SKIP" : "FAIL"
            const latency = result.latencyMs ? ` (${result.latencyMs}ms)` : ""
            console.log(` [${statusIcon}]${latency}`)
            if (result.error && result.status === "error") {
              console.log(`    Error: ${result.errorType}: ${result.error?.substring(0, 80)}...`)
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

  console.log(`\n${"=".repeat(60)}`)
  console.log("SUMMARY")
  console.log(`${"=".repeat(60)}`)
  console.log(`Total: ${results.length} | OK: ${successful.length} | FAILED: ${failed.length} | SKIPPED: ${skipped.length}`)

  if (successful.length > 0) {
    console.log(`\nSUCCESSFUL (${successful.length}):`)
    for (const r of successful) {
      console.log(`  [OK] ${r.provider}/${r.model} (${r.latencyMs}ms) - "${r.response}"`)
    }
  }

  if (failed.length > 0) {
    console.log(`\nFAILED (${failed.length}):`)

    // Group by error type
    const byErrorType = new Map<string, TestResult[]>()
    for (const r of failed) {
      const type = r.errorType || "Unknown"
      if (!byErrorType.has(type)) byErrorType.set(type, [])
      byErrorType.get(type)!.push(r)
    }

    for (const [errorType, errs] of byErrorType) {
      console.log(`\n  ${errorType} (${errs.length}):`)
      for (const r of errs) {
        console.log(`    - ${r.provider}/${r.model}`)
        console.log(`      ${r.error?.substring(0, 100)}`)
      }
    }
  }

  if (skipped.length > 0) {
    console.log(`\nSKIPPED - Missing Auth (${skipped.length}):`)
    const providers = new Set(skipped.map((r) => r.provider))
    for (const p of providers) {
      const first = skipped.find((r) => r.provider === p)
      console.log(`  - ${p}: ${first?.error}`)
    }
  }

  console.log(`\n${"=".repeat(60)}\n`)

  // Exit with error code if any failures
  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("Fatal error:", e)
  process.exit(1)
})
