/**
 * Provider Health Test - Tests all providers and models with minimal requests
 *
 * This is a LIVE test that makes real API calls to all configured providers.
 * Run with: bun test test/provider/provider-health.live.test.ts
 *
 * The test requires actual API keys to be set in the environment.
 * Missing keys will be reported but won't fail the test.
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderTransform } from "../../src/provider/transform"
import { generateText, type LanguageModel } from "ai"
import { Env } from "../../src/env"
import path from "path"

interface TestResult {
  provider: string
  model: string
  status: "success" | "error" | "skipped"
  error?: string
  errorType?: string
  latencyMs?: number
}

const results: TestResult[] = []

describe("Provider Health Check", { timeout: 120_000 }, () => {
  let tmpDir: Awaited<ReturnType<typeof tmpdir>> | undefined
  let providers: Record<string, Provider.Info> = {}

  beforeAll(async () => {
    tmpDir = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "agent-core.json"),
          JSON.stringify({
            $schema: "agent-core",
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmpDir.path,
      fn: async () => {
        providers = await Provider.list()
      },
    })
  })

  afterAll(async () => {
    console.log("\n" + "=".repeat(80))
    console.log("PROVIDER HEALTH CHECK RESULTS")
    console.log("=".repeat(80))

    const successful = results.filter((r) => r.status === "success")
    const failed = results.filter((r) => r.status === "error")
    const skipped = results.filter((r) => r.status === "skipped")

    console.log(`\nSummary: ${successful.length} OK, ${failed.length} FAILED, ${skipped.length} SKIPPED\n`)

    if (successful.length > 0) {
      console.log("SUCCESSFUL:")
      for (const r of successful) {
        console.log(`  [OK] ${r.provider}/${r.model} (${r.latencyMs}ms)`)
      }
    }

    if (skipped.length > 0) {
      console.log("\nSKIPPED (missing auth):")
      for (const r of skipped) {
        console.log(`  [SKIP] ${r.provider}/${r.model}: ${r.error}`)
      }
    }

    if (failed.length > 0) {
      console.log("\nFAILED:")
      for (const r of failed) {
        console.log(`  [FAIL] ${r.provider}/${r.model}`)
        console.log(`         Type: ${r.errorType}`)
        console.log(`         Error: ${r.error}`)
      }
    }

    console.log("\n" + "=".repeat(80))

    if (tmpDir) {
      await tmpDir[Symbol.asyncDispose]()
    }
  })

  test("test all providers and models", async () => {
    const providerList = Object.entries(providers)
    console.log(`\nFound ${providerList.length} providers to test`)

    for (const [providerID, providerInfo] of providerList) {
      const modelList = Object.entries(providerInfo.models)
      console.log(`\nTesting ${providerID} (${modelList.length} models)...`)

      // Test only the first non-deprecated model per provider to save time/cost
      const testableModels = modelList.filter(([_, model]) => model.status !== "deprecated").slice(0, 1)

      for (const [modelID, model] of testableModels) {
        const result = await testModel(providerID, providerInfo, modelID, model)
        results.push(result)

        const statusIcon = result.status === "success" ? "OK" : result.status === "skipped" ? "SKIP" : "FAIL"
        console.log(`  [${statusIcon}] ${modelID}${result.latencyMs ? ` (${result.latencyMs}ms)` : ""}`)
        if (result.error && result.status !== "skipped") {
          console.log(`       Error: ${result.error?.substring(0, 100)}...`)
        }
      }
    }

    // Report summary
    const failed = results.filter((r) => r.status === "error")
    if (failed.length > 0) {
      console.log(`\nWARNING: ${failed.length} models failed health check`)
    }
  })
})

async function testModel(
  providerID: string,
  providerInfo: Provider.Info,
  modelID: string,
  model: Provider.Model,
): Promise<TestResult> {
  const startTime = Date.now()

  try {
    // Check if provider has required authentication
    if (!providerInfo.source || providerInfo.source === "none") {
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
      }
    }

    // Build provider options
    const options = ProviderTransform.options({
      model,
      sessionID: "health-check",
      providerOptions: providerInfo.options,
    })

    // Make a minimal request
    const result = await generateText({
      model: language,
      prompt: "ping",
      temperature: 0,
      maxOutputTokens: 1,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(15000),
      providerOptions: ProviderTransform.providerOptions(model, options),
      headers: model.headers,
    })

    const latencyMs = Date.now() - startTime

    return {
      provider: providerID,
      model: modelID,
      status: "success",
      latencyMs,
    }
  } catch (e: unknown) {
    const err = e as Error
    const latencyMs = Date.now() - startTime

    // Categorize error types for better diagnostics
    const errorType = categorizeError(err)

    return {
      provider: providerID,
      model: modelID,
      status: "error",
      error: err.message?.substring(0, 500) || String(e),
      errorType,
      latencyMs,
    }
  }
}

function categorizeError(err: Error): string {
  const message = err.message?.toLowerCase() || ""
  const name = err.name || ""

  if (message.includes("unauthorized") || message.includes("authentication") || message.includes("api key")) {
    return "AuthError"
  }
  if (message.includes("rate limit") || message.includes("too many requests") || message.includes("429")) {
    return "RateLimitError"
  }
  if (message.includes("timeout") || message.includes("timed out") || message.includes("econnrefused")) {
    return "TimeoutError"
  }
  if (message.includes("not found") || message.includes("404") || message.includes("model not found")) {
    return "ModelNotFoundError"
  }
  if (message.includes("quota") || message.includes("billing") || message.includes("insufficient")) {
    return "QuotaError"
  }
  if (message.includes("invalid") || message.includes("bad request") || message.includes("400")) {
    return "ValidationError"
  }
  if (message.includes("server error") || message.includes("500") || message.includes("502") || message.includes("503")) {
    return "ServerError"
  }

  return name || "UnknownError"
}
