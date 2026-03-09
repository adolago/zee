import { describe, expect, test } from "bun:test"
import {
  executeBenchmarkCommand,
  runBenchmarkAttempt,
  summarizeBenchmarkRuns,
  type BenchmarkAppEvent,
  type BenchmarkAttempt,
  type BenchmarkCommandDeps,
  type BenchmarkModelRef,
  type BenchmarkRunReport,
  type BenchmarkRuntime,
} from "../../src/cli/cmd/benchmark"

type Scenario = {
  events: BenchmarkAppEvent[]
  promptError?: string
  eventDelayMs?: number
}

function createAsyncQueue<T>() {
  const items: T[] = []
  let resolver: ((value: IteratorResult<T>) => void) | null = null
  let done = false

  return {
    push(value: T) {
      if (done) return
      if (resolver) {
        resolver({ value, done: false })
        resolver = null
        return
      }
      items.push(value)
    },
    close() {
      if (done) return
      done = true
      if (resolver) {
        resolver({ value: undefined, done: true })
        resolver = null
      }
    },
    stream: {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<T>> {
            if (items.length > 0) {
              return { value: items.shift() as T, done: false }
            }
            if (done) {
              return { value: undefined, done: true }
            }
            return await new Promise<IteratorResult<T>>((resolve) => {
              resolver = resolve
            })
          },
          async return(): Promise<IteratorResult<T>> {
            done = true
            if (resolver) {
              resolver({ value: undefined, done: true })
              resolver = null
            }
            return { value: undefined, done: true }
          },
        }
      },
    } satisfies AsyncIterable<T>,
  }
}

function createFakeRuntime(scenarios: Scenario[]) {
  const beginInputs: Array<{
    title: string
    agent: string
    model: BenchmarkModelRef
    variant?: string
    prompt: string
    system: string
  }> = []
  const cleanedSessionIDs: string[] = []
  const rejectedPermissions: Array<{ sessionID: string; permissionID: string }> = []
  let counter = 0

  const runtime: BenchmarkRuntime = {
    async beginAttempt(input): Promise<BenchmarkAttempt> {
      const scenario = scenarios.shift()
      if (!scenario) {
        throw new Error("Missing fake benchmark scenario")
      }

      beginInputs.push(input)
      counter += 1
      const sessionID = `ses_${counter}`
      const queue = createAsyncQueue<BenchmarkAppEvent>()

      return {
        sessionID,
        events: queue.stream,
        async prompt() {
          if (scenario.promptError) {
            throw new Error(scenario.promptError)
          }

          for (const event of scenario.events) {
            queue.push(event)
            if ((scenario.eventDelayMs ?? 0) > 0) {
              await Bun.sleep(scenario.eventDelayMs)
            }
          }
          queue.close()
        },
        async rejectPermission(permissionID: string) {
          rejectedPermissions.push({ sessionID, permissionID })
        },
        async cleanup() {
          cleanedSessionIDs.push(sessionID)
          queue.close()
        },
      }
    },
  }

  return {
    runtime,
    beginInputs,
    cleanedSessionIDs,
    rejectedPermissions,
  }
}

function partUpdated(sessionID: string, part: Record<string, unknown>, delta?: string): BenchmarkAppEvent {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        id: "part_1",
        messageID: "msg_1",
        sessionID,
        ...part,
      },
      delta,
    },
  }
}

function sessionIdle(sessionID: string): BenchmarkAppEvent {
  return {
    type: "session.idle",
    properties: { sessionID },
  }
}

describe("benchmark command helpers", () => {
  test("runBenchmarkAttempt captures first activity before TTFT when reasoning arrives first", async () => {
    const fake = createFakeRuntime([
      {
        eventDelayMs: 3,
        events: [
          partUpdated("ses_1", { type: "reasoning", text: "" }, "Thinking"),
          partUpdated("ses_1", { type: "text", text: "" }, "Hello benchmark"),
          partUpdated("ses_1", {
            type: "step-finish",
            reason: "stop",
            cost: 0,
            tokens: {
              input: 20,
              output: 32,
              reasoning: 12,
              cache: { read: 0, write: 0 },
            },
          }),
          sessionIdle("ses_1"),
        ],
      },
    ])

    const run = await runBenchmarkAttempt({
      runtime: fake.runtime,
      title: "bench",
      index: 1,
      warmup: false,
      agent: "zee",
      model: { providerID: "openai", modelID: "gpt-test" },
      prompt: "Hello",
      system: "Benchmark system",
    })

    expect(run.status).toBe("ok")
    expect(run.firstActivityMs).not.toBeNull()
    expect(run.ttftMs).not.toBeNull()
    expect(run.ttftMs!).toBeGreaterThan(run.firstActivityMs!)
    expect(run.outputTokens).toBe(32)
    expect(run.tokenSource).toBe("reported")
    expect(fake.cleanedSessionIDs).toEqual(["ses_1"])
  })

  test("runBenchmarkAttempt invalidates tool calls and rejects permissions", async () => {
    const fake = createFakeRuntime([
      {
        events: [
          partUpdated("ses_1", { type: "tool", tool: "bash", state: { status: "pending" } }),
          {
            type: "permission.asked",
            properties: {
              id: "perm_1",
              sessionID: "ses_1",
              permission: "bash",
              patterns: ["*"],
            },
          },
          sessionIdle("ses_1"),
        ],
      },
    ])

    const run = await runBenchmarkAttempt({
      runtime: fake.runtime,
      title: "bench",
      index: 1,
      warmup: false,
      agent: "zee",
      model: { providerID: "openai", modelID: "gpt-test" },
      prompt: "Hello",
      system: "Benchmark system",
    })

    expect(run.status).toBe("invalid")
    expect(run.invalidReason).toContain("tool call: bash")
    expect(fake.rejectedPermissions).toEqual([{ sessionID: "ses_1", permissionID: "perm_1" }])
    expect(fake.cleanedSessionIDs).toEqual(["ses_1"])
  })

  test("runBenchmarkAttempt falls back to estimated tokens when usage is missing", async () => {
    const fake = createFakeRuntime([
      {
        events: [partUpdated("ses_1", { type: "text", text: "" }, "a".repeat(40)), sessionIdle("ses_1")],
      },
    ])

    const run = await runBenchmarkAttempt({
      runtime: fake.runtime,
      title: "bench",
      index: 1,
      warmup: false,
      agent: "zee",
      model: { providerID: "openai", modelID: "gpt-test" },
      prompt: "Hello",
      system: "Benchmark system",
    })

    expect(run.status).toBe("ok")
    expect(run.outputTokens).toBeGreaterThan(0)
    expect(run.tokenSource).toBe("estimated_chars")
  })

  test("summarizeBenchmarkRuns excludes warmups and invalid runs from metrics", () => {
    const runs: BenchmarkRunReport[] = [
      {
        index: 1,
        warmup: true,
        model: "openai/gpt-test",
        status: "ok",
        firstActivityMs: 20,
        ttftMs: 40,
        totalMs: 200,
        outputTokens: 30,
        reasoningTokens: 0,
        tokenSource: "reported",
        generationTokensPerSec: 200,
        effectiveTokensPerSec: 150,
      },
      {
        index: 2,
        warmup: false,
        model: "openai/gpt-test",
        status: "ok",
        firstActivityMs: 25,
        ttftMs: 50,
        totalMs: 250,
        outputTokens: 40,
        reasoningTokens: 0,
        tokenSource: "reported",
        generationTokensPerSec: 210,
        effectiveTokensPerSec: 160,
      },
      {
        index: 3,
        warmup: false,
        model: "openai/gpt-test",
        status: "invalid",
        firstActivityMs: 30,
        ttftMs: null,
        totalMs: 300,
        outputTokens: null,
        reasoningTokens: null,
        tokenSource: "missing",
        generationTokensPerSec: null,
        effectiveTokensPerSec: null,
        invalidReason: "tool call: bash",
      },
    ]

    const summary = summarizeBenchmarkRuns(runs, { requestedRuns: 2, warmupRuns: 1 })
    expect(summary.validRuns).toBe(1)
    expect(summary.invalidRuns).toBe(1)
    expect(summary.ttftMs.mean).toBe(50)
    expect(summary.totalMs.mean).toBe(250)
  })

  test("executeBenchmarkCommand resolves the default model and prints human output", async () => {
    const fake = createFakeRuntime([
      {
        events: [
          partUpdated("ses_1", { type: "text", text: "" }, "Hello benchmark"),
          partUpdated("ses_1", {
            type: "step-finish",
            reason: "stop",
            cost: 0,
            tokens: {
              input: 12,
              output: 18,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          }),
          sessionIdle("ses_1"),
        ],
      },
    ])
    let defaultModelCalls = 0
    let output = ""

    const deps: BenchmarkCommandDeps = {
      runtime: fake.runtime,
      cwd: "/tmp/zee-bench",
      print: (text) => {
        output += text
      },
      resolveDefaultModel: async () => {
        defaultModelCalls += 1
        return { providerID: "openai", modelID: "gpt-test" }
      },
      validateAgent: async (agent) => agent,
      validateModel: async () => {},
    }

    const result = await executeBenchmarkCommand(
      {
        runs: 1,
        warmup: 0,
      },
      deps,
    )

    expect(result.exitCode).toBe(0)
    expect(defaultModelCalls).toBe(1)
    expect(output).toContain("Benchmark results")
    expect(output).toContain("Model: openai/gpt-test")
    expect(fake.cleanedSessionIDs).toEqual(["ses_1"])
  })

  test("executeBenchmarkCommand writes JSON to stdout and a report file", async () => {
    const fake = createFakeRuntime([
      {
        events: [
          partUpdated("ses_1", { type: "text", text: "" }, "Hello benchmark"),
          partUpdated("ses_1", {
            type: "step-finish",
            reason: "stop",
            cost: 0,
            tokens: {
              input: 12,
              output: 18,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          }),
          sessionIdle("ses_1"),
        ],
      },
    ])
    let printed = ""
    let writtenPath = ""
    let writtenBody = ""

    const result = await executeBenchmarkCommand(
      {
        model: ["openai/gpt-test"],
        runs: 1,
        warmup: 0,
        json: true,
        output: "reports/bench.json",
      },
      {
        runtime: fake.runtime,
        cwd: "/tmp/zee-bench",
        print: (text) => {
          printed += text
        },
        writeReportFile: async (filePath, contents) => {
          writtenPath = filePath
          writtenBody = contents
        },
        validateAgent: async (agent) => agent,
        validateModel: async () => {},
      },
    )

    const stdoutJson = JSON.parse(printed)
    const fileJson = JSON.parse(writtenBody)

    expect(result.exitCode).toBe(0)
    expect(stdoutJson.models[0].model).toBe("openai/gpt-test")
    expect(fileJson.models[0].model).toBe("openai/gpt-test")
    expect(writtenPath).toBe("/tmp/zee-bench/reports/bench.json")
  })

  test("executeBenchmarkCommand cleans up sessions on failure and returns non-zero exit code", async () => {
    const fake = createFakeRuntime([
      {
        events: [],
        promptError: "provider exploded",
      },
    ])

    const result = await executeBenchmarkCommand(
      {
        model: ["openai/gpt-test"],
        runs: 1,
        warmup: 0,
        json: true,
      },
      {
        runtime: fake.runtime,
        print: () => {},
        validateAgent: async (agent) => agent,
        validateModel: async () => {},
      },
    )

    expect(result.exitCode).toBe(1)
    expect(result.report.models[0]?.runs[0]?.status).toBe("error")
    expect(fake.cleanedSessionIDs).toEqual(["ses_1"])
  })
})
