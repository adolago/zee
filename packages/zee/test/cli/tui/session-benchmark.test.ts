import { describe, expect, mock, test } from "bun:test"
import {
  BENCHMARK_DEFAULTS,
  type BenchmarkAppEvent,
  type BenchmarkModelRef,
} from "../../../src/cli/cmd/benchmark"
import {
  createSessionBenchmarkCommand,
  runSessionBenchmark,
} from "../../../src/cli/cmd/tui/routes/session/benchmark"

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

function createHarness(options?: {
  beginError?: string
  promptErrorAtRun?: number
}) {
  const listeners = new Set<(event: BenchmarkAppEvent) => void>()
  const notes: Array<{ parameters: Record<string, unknown>; options: Record<string, unknown> | undefined }> = []
  const promptAsyncCalls: Array<{ parameters: Record<string, unknown>; options: Record<string, unknown> | undefined }> =
    []
  const createCalls: Array<Record<string, unknown> | undefined> = []
  const deletedSessionIDs: string[] = []
  const toasts: Array<{ message: string; variant: string }> = []
  let sessionCounter = 0
  let promptCount = 0
  let unsubscribeCount = 0

  const model: BenchmarkModelRef = { providerID: "openai", modelID: "gpt-5.4" }

  const sdk = {
    session: {
      async create(parameters?: Record<string, unknown>) {
        createCalls.push(parameters)
        if (options?.beginError) throw new Error(options.beginError)
        sessionCounter += 1
        return { data: { id: `bench_${sessionCounter}` } }
      },
      async promptAsync(parameters: Record<string, unknown>, promptOptions?: Record<string, unknown>) {
        promptAsyncCalls.push({ parameters, options: promptOptions })
        promptCount += 1
        if (options?.promptErrorAtRun === promptCount) {
          throw new Error(`prompt failed on run ${promptCount}`)
        }

        const sessionID = String(parameters.sessionID)
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener(partUpdated(sessionID, { type: "reasoning", text: "" }, `Thinking ${promptCount}`))
            listener(partUpdated(sessionID, { type: "text", text: "" }, `Benchmark output ${promptCount}`))
            listener(
              partUpdated(sessionID, {
                type: "step-finish",
                reason: "stop",
                cost: 0,
                tokens: {
                  input: 12,
                  output: 18 + promptCount,
                  reasoning: 4 + promptCount,
                  cache: { read: 0, write: 0 },
                },
              }),
            )
            listener(sessionIdle(sessionID))
          }
        })
        return { data: undefined }
      },
      async delete(input: { sessionID: string }) {
        deletedSessionIDs.push(input.sessionID)
        return { data: undefined }
      },
      async note(parameters: Record<string, unknown>, noteOptions?: Record<string, unknown>) {
        notes.push({ parameters, options: noteOptions })
        return {
          data: {
            info: { id: "message_note", role: "user" },
            parts: [
              {
                id: "part_note",
                type: "text",
                text: parameters.text,
              },
            ],
          },
        }
      },
    },
    permission: {
      async respond() {
        return { data: undefined }
      },
    },
  }

  const eventSource = {
    subscribe(handler: (event: BenchmarkAppEvent) => void) {
      listeners.add(handler)
      return () => {
        unsubscribeCount += 1
        listeners.delete(handler)
      }
    },
  }

  const toast = {
    show(input: { message: string; variant: "info" | "success" | "warning" | "error" }) {
      toasts.push({ message: input.message, variant: input.variant })
    },
  }

  return {
    model,
    sdk: sdk as any,
    eventSource,
    toast,
    notes,
    toasts,
    createCalls,
    promptAsyncCalls,
    deletedSessionIDs,
    get unsubscribeCount() {
      return unsubscribeCount
    },
  }
}

describe("session benchmark helpers", () => {
  test("runSessionBenchmark uses default runs and writes an ignored summary note", async () => {
    const harness = createHarness()

    const report = await runSessionBenchmark({
      cwd: "/tmp/bench",
      sessionID: "session_live",
      agent: "zee",
      model: harness.model,
      variant: "reasoning",
      sdk: harness.sdk,
      eventSource: harness.eventSource,
      toast: harness.toast,
    })

    expect(report.options.runs).toBe(BENCHMARK_DEFAULTS.runs)
    expect(report.options.warmup).toBe(BENCHMARK_DEFAULTS.warmup)
    expect(harness.createCalls).toHaveLength(BENCHMARK_DEFAULTS.runs + BENCHMARK_DEFAULTS.warmup)
    expect(harness.promptAsyncCalls).toHaveLength(BENCHMARK_DEFAULTS.runs + BENCHMARK_DEFAULTS.warmup)
    expect(harness.promptAsyncCalls[0]).toEqual({
      parameters: {
        sessionID: "bench_1",
        agent: "zee",
        model: harness.model,
        variant: "reasoning",
        tools: {},
        system: BENCHMARK_DEFAULTS.system,
        parts: [{ type: "text", text: BENCHMARK_DEFAULTS.prompt }],
      },
      options: { throwOnError: true },
    })
    expect(harness.deletedSessionIDs).toEqual(["bench_1", "bench_2", "bench_3", "bench_4"])
    expect(harness.unsubscribeCount).toBe(BENCHMARK_DEFAULTS.runs + BENCHMARK_DEFAULTS.warmup)

    expect(harness.notes).toHaveLength(1)
    expect(harness.notes[0]).toEqual({
      parameters: expect.objectContaining({
        sessionID: "session_live",
        role: "user",
        ignored: true,
        metadata: expect.objectContaining({
          kind: "benchmark",
          agent: "zee",
          model: "openai/gpt-5.4",
          variant: "reasoning",
          validRuns: BENCHMARK_DEFAULTS.runs,
        }),
        text: expect.stringContaining("Benchmark: openai/gpt-5.4"),
      }),
      options: { throwOnError: true },
    })
    expect(harness.notes[0]?.parameters.text).toContain("Runs:")
    expect(harness.notes[0]?.parameters.text).toContain("Valid runs:")
    expect(harness.notes[0]?.parameters.text).toContain("Runs\n#1  warmup")
    expect(harness.toasts.map((item) => item.variant)).toEqual(["info", "success"])
  })

  test("runSessionBenchmark appends a failure note when benchmark startup fails", async () => {
    const harness = createHarness({ beginError: "session create failed" })

    await expect(
      runSessionBenchmark({
        cwd: "/tmp/bench",
        sessionID: "session_live",
        agent: "zee",
        model: harness.model,
        sdk: harness.sdk,
        eventSource: harness.eventSource,
        toast: harness.toast,
      }),
    ).rejects.toThrow("session create failed")

    expect(harness.promptAsyncCalls).toHaveLength(0)
    expect(harness.notes).toHaveLength(1)
    expect(harness.notes[0]).toEqual({
      parameters: {
        sessionID: "session_live",
        role: "user",
        text: "Benchmark failed: openai/gpt-5.4\nAgent: zee\nError: session create failed",
        ignored: true,
        metadata: {
          kind: "benchmark",
          agent: "zee",
          model: "openai/gpt-5.4",
          variant: undefined,
          error: "session create failed",
        },
      },
      options: { throwOnError: true },
    })
    expect(harness.toasts.map((item) => item.variant)).toEqual(["info", "error"])
  })

  test("createSessionBenchmarkCommand blocks duplicate invocations while running", () => {
    const harness = createHarness()
    const clear = mock(() => {})

    const command = createSessionBenchmarkCommand({
      sessionID: () => "session_live",
      cwd: () => "/tmp/bench",
      agent: () => "zee",
      model: () => harness.model,
      variant: () => undefined,
      sdk: harness.sdk,
      eventSource: harness.eventSource,
      toast: harness.toast,
      isRunning: () => true,
      setRunning: () => {},
    })

    command.onSelect?.({ clear } as any)

    expect(clear).toHaveBeenCalledTimes(1)
    expect(harness.promptAsyncCalls).toHaveLength(0)
    expect(harness.notes).toHaveLength(0)
    expect(harness.toasts).toEqual([
      {
        message: "Benchmark already running for this session",
        variant: "warning",
      },
    ])
  })
})
