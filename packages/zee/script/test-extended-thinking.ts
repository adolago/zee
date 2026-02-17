#!/usr/bin/env bun
/**
 * Manual test script for extended-thinking model fix.
 *
 * Tests that tool-only responses trigger follow-up and produce final text.
 *
 * Usage:
 *   bun script/test-extended-thinking.ts [model]
 *
 * Examples:
 *   bun script/test-extended-thinking.ts openai/gpt-5.2
 *   bun script/test-extended-thinking.ts kimi-for-coding/kimi-k2-thinking
 */

import { createZeeClient as createEventClient } from "@zee/sdk"
import { createZeeClient } from "@zee/sdk/v2"

const DEFAULT_MODEL = "openai/gpt-5.2"
const TEST_TIMEOUT = 180_000 // 3 minutes

interface TestResult {
  passed: boolean
  toolCalls: string[]
  hasText: boolean
  finishReason: string | null
  error?: string
  durationMs: number
}

async function runTest(baseUrl: string, model: string, prompt: string): Promise<TestResult> {
  const sdk = createZeeClient({ baseUrl })
  const eventClient = createEventClient({ baseUrl })

  const startTime = Date.now()
  const toolCalls: string[] = []
  let text = ""
  let finishReason: string | null = null
  let error: string | undefined

  // Create session
  const sessionResult = await sdk.session.create({})
  const sessionID = sessionResult.data!.id
  console.log(`  Session: ${sessionID}`)

  // Set up event listener
  const eventPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout after ${TEST_TIMEOUT}ms`))
    }, TEST_TIMEOUT)

    ;(async () => {
      try {
        const subscription = await eventClient.event.subscribe()
        for await (const event of subscription.stream) {
          if (event.type === "message.updated") {
            const props = event.properties as any
            if (props.info?.sessionID !== sessionID) continue
            if (props.info?.role !== "assistant") continue

            finishReason = props.info.finish ?? null

            for (const part of props.parts ?? []) {
              if (part.type === "text" && part.text?.trim()) {
                text = part.text
              }
              if (part.type === "tool" && !toolCalls.includes(part.tool)) {
                toolCalls.push(part.tool)
                console.log(`  Tool: ${part.tool}`)
              }
            }
          }

          if (event.type === "session.error") {
            const props = event.properties as any
            if (props.sessionID !== sessionID) continue
            error = props.error?.message ?? String(props.error)
          }

          if (event.type === "session.idle") {
            const props = event.properties as any
            if (props.sessionID === sessionID) {
              clearTimeout(timeout)
              resolve()
              return
            }
          }
        }
      } catch (e) {
        clearTimeout(timeout)
        reject(e)
      }
    })()
  })

  // Send prompt
  const [providerID, modelID] = model.split("/")
  await sdk.session.prompt({
    sessionID,
    model: { providerID, modelID },
    parts: [{ type: "text", text: prompt }],
  })

  await eventPromise

  const durationMs = Date.now() - startTime
  const hasText = text.trim().length > 0
  const passed = toolCalls.length > 0 && hasText && finishReason === "stop" && !error

  return {
    passed,
    toolCalls,
    hasText,
    finishReason,
    error,
    durationMs,
  }
}

async function main() {
  const model = process.argv[2] || DEFAULT_MODEL
  const baseUrl = process.env.ZEE_URL || "http://127.0.0.1:9021"

  console.log(`\n🧪 Extended Thinking Model Test`)
  console.log(`   Model: ${model}`)
  console.log(`   Server: ${baseUrl}\n`)

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`Test 1: Tool call followed by text synthesis`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

  try {
    const result = await runTest(
      baseUrl,
      model,
      "Read the AGENTS.md file in this directory and tell me what the project is about in one sentence.",
    )

    console.log(`\n  Results:`)
    console.log(`    Tool calls: ${result.toolCalls.join(", ") || "none"}`)
    console.log(`    Has text:   ${result.hasText}`)
    console.log(`    Finish:     ${result.finishReason}`)
    console.log(`    Duration:   ${(result.durationMs / 1000).toFixed(1)}s`)
    if (result.error) console.log(`    Error:      ${result.error}`)

    if (result.passed) {
      console.log(`\n  + PASSED - Tool-only response triggered follow-up\n`)
    } else {
      console.log(`\n  x FAILED - ${result.error || "Missing text synthesis after tool call"}\n`)
      process.exit(1)
    }
  } catch (e) {
    console.log(`\n  x ERROR: ${e}\n`)
    process.exit(1)
  }
}

main()
