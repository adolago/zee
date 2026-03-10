import type { ZeeClient } from "@zee/sdk/v2"
import type { CommandOption } from "@tui/component/dialog-command"
import {
  BENCHMARK_DEFAULTS,
  benchmarkModelLabel,
  createSdkBenchmarkRuntime,
  runBenchmarkSuite,
  type BenchmarkEventSource,
  type BenchmarkModelRef,
  type BenchmarkModelReport,
  type BenchmarkReport,
  type BenchmarkRunReport,
  type BenchmarkSummaryMetric,
} from "../../../benchmark"

type ToastLike = {
  show(options: {
    message: string
    variant: "info" | "success" | "warning" | "error"
    duration?: number
    title?: string
  }): void
}

type SessionNoteClient = Pick<ZeeClient, "session" | "permission">

export function formatBenchmarkSessionNote(input: {
  agent: string
  model: BenchmarkModelRef
  variant?: string
  report: BenchmarkReport
}): string {
  const label = benchmarkModelLabel(input.model)
  const modelReport = input.report.models[0]
  const lines = [
    `Benchmark: ${label}`,
    `Agent: ${input.agent}`,
    ...(input.variant ? [`Variant: ${input.variant}`] : []),
    `Runs: ${BENCHMARK_DEFAULTS.runs} measured, ${BENCHMARK_DEFAULTS.warmup} warmup`,
  ]

  if (!modelReport) {
    return [...lines, "", "No benchmark report data was produced."].join("\n")
  }

  lines.push("")
  lines.push(
    `Valid runs: ${modelReport.summary.validRuns}/${modelReport.summary.requestedRuns} measured (${modelReport.summary.invalidRuns} invalid, ${modelReport.summary.errorRuns} errors)`,
  )
  lines.push(`First activity: ${formatMetricLine(modelReport.summary.firstActivityMs, formatMs)}`)
  lines.push(`TTFT: ${formatMetricLine(modelReport.summary.ttftMs, formatMs)}`)
  lines.push(`Total latency: ${formatMetricLine(modelReport.summary.totalMs, formatMs)}`)
  lines.push(`Output tokens: ${formatMetricLine(modelReport.summary.outputTokens, formatCount)}`)
  lines.push(`Generation tok/s: ${formatMetricLine(modelReport.summary.generationTokensPerSec, formatNumber)}`)
  lines.push(`Effective tok/s: ${formatMetricLine(modelReport.summary.effectiveTokensPerSec, formatNumber)}`)
  lines.push("")
  lines.push("Runs")

  for (const run of modelReport.runs) {
    lines.push(formatRunLine(run))
  }

  return lines.join("\n")
}

export function formatBenchmarkFailureNote(input: {
  agent: string
  model: BenchmarkModelRef
  variant?: string
  error: unknown
}): string {
  const lines = [
    `Benchmark failed: ${benchmarkModelLabel(input.model)}`,
    `Agent: ${input.agent}`,
    ...(input.variant ? [`Variant: ${input.variant}`] : []),
    `Error: ${formatError(input.error)}`,
  ]
  return lines.join("\n")
}

export async function runSessionBenchmark(input: {
  cwd: string
  sessionID: string
  agent: string
  model: BenchmarkModelRef
  variant?: string
  sdk: SessionNoteClient
  eventSource: BenchmarkEventSource
  toast: ToastLike
}): Promise<BenchmarkReport> {
  const label = benchmarkModelLabel(input.model)

  input.toast.show({
    variant: "info",
    message: `Benchmarking ${label}`,
    duration: 2000,
  })

  try {
    const report = await runBenchmarkSuite({
      runtime: createSdkBenchmarkRuntime(input.sdk, input.eventSource),
      cwd: input.cwd,
      agent: input.agent,
      models: [input.model],
      variant: input.variant,
      runs: BENCHMARK_DEFAULTS.runs,
      warmup: BENCHMARK_DEFAULTS.warmup,
      prompt: BENCHMARK_DEFAULTS.prompt,
      system: BENCHMARK_DEFAULTS.system,
    })

    await appendBenchmarkNote({
      sdk: input.sdk,
      sessionID: input.sessionID,
      text: formatBenchmarkSessionNote({
        agent: input.agent,
        model: input.model,
        variant: input.variant,
        report,
      }),
      model: input.model,
      variant: input.variant,
      report,
      agent: input.agent,
    })

    const summary = report.models[0]?.summary
    if (!summary || summary.validRuns === 0) {
      input.toast.show({
        variant: "error",
        message: `Benchmark finished with no valid runs for ${label}`,
        duration: 5000,
      })
      return report
    }

    input.toast.show({
      variant: "success",
      message: `Benchmark complete for ${label}`,
      duration: 3000,
    })
    return report
  } catch (error) {
    await appendFailureNote({
      sdk: input.sdk,
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      variant: input.variant,
      error,
    })

    input.toast.show({
      variant: "error",
      message: `Benchmark failed for ${label}: ${formatError(error)}`,
      duration: 7000,
    })
    throw error
  }
}

export function createSessionBenchmarkCommand(input: {
  sessionID: () => string
  cwd: () => string
  agent: () => string
  model: () => BenchmarkModelRef | undefined
  variant: () => string | undefined
  sdk: SessionNoteClient
  eventSource: BenchmarkEventSource
  toast: ToastLike
  isRunning: () => boolean
  setRunning(next: boolean): void
}): CommandOption {
  return {
    title: input.isRunning() ? "Benchmark current model (running)" : "Benchmark current model",
    value: "session.benchmark",
    category: "Session",
    slash: {
      name: "benchmark",
    },
    enabled: !!input.model(),
    onSelect: (dialog) => {
      dialog.clear()

      if (input.isRunning()) {
        input.toast.show({
          variant: "warning",
          message: "Benchmark already running for this session",
          duration: 3000,
        })
        return
      }

      const model = input.model()
      if (!model) {
        input.toast.show({
          variant: "warning",
          message: "No model selected for benchmark",
          duration: 3000,
        })
        return
      }

      input.setRunning(true)
      void runSessionBenchmark({
        cwd: input.cwd(),
        sessionID: input.sessionID(),
        agent: input.agent(),
        model,
        variant: input.variant(),
        sdk: input.sdk,
        eventSource: input.eventSource,
        toast: input.toast,
      }).finally(() => {
        input.setRunning(false)
      })
    },
  }
}

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a"
  if (value >= 1000) return `${round(value / 1000, 2)}s`
  return `${round(value, 1)}ms`
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a"
  return `${Math.round(value)}`
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a"
  return round(value).toFixed(2)
}

function formatMetricLine(metric: BenchmarkSummaryMetric, formatter: (value: number | null | undefined) => string): string {
  if (metric.mean === null) return "n/a"
  return `mean=${formatter(metric.mean)} median=${formatter(metric.median)} min=${formatter(metric.min)} max=${formatter(metric.max)}`
}

function formatRunLine(run: BenchmarkRunReport): string {
  const note = run.error ?? run.invalidReason
  const segments = [
    `#${run.index}`,
    run.warmup ? "warmup" : "measured",
    run.status,
    `first=${formatMs(run.firstActivityMs)}`,
    `ttft=${formatMs(run.ttftMs)}`,
    `total=${formatMs(run.totalMs)}`,
    `out=${formatCount(run.outputTokens)}`,
    `gen=${formatNumber(run.generationTokensPerSec)}`,
    `eff=${formatNumber(run.effectiveTokensPerSec)}`,
  ]
  if (note) segments.push(note)
  return segments.join("  ")
}

async function appendBenchmarkNote(input: {
  sdk: SessionNoteClient
  sessionID: string
  text: string
  model: BenchmarkModelRef
  variant?: string
  report: BenchmarkReport
  agent: string
}) {
  const modelReport = input.report.models[0]
  await input.sdk.session.note(
    {
      sessionID: input.sessionID,
      role: "user",
      text: input.text,
      ignored: true,
      metadata: {
        kind: "benchmark",
        agent: input.agent,
        model: benchmarkModelLabel(input.model),
        variant: input.variant,
        generatedAt: input.report.generatedAt,
        validRuns: modelReport?.summary.validRuns ?? 0,
      },
    },
    { throwOnError: true },
  )
}

async function appendFailureNote(input: {
  sdk: SessionNoteClient
  sessionID: string
  agent: string
  model: BenchmarkModelRef
  variant?: string
  error: unknown
}) {
  try {
    await input.sdk.session.note(
      {
        sessionID: input.sessionID,
        role: "user",
        text: formatBenchmarkFailureNote(input),
        ignored: true,
        metadata: {
          kind: "benchmark",
          agent: input.agent,
          model: benchmarkModelLabel(input.model),
          variant: input.variant,
          error: formatError(input.error),
        },
      },
      { throwOnError: true },
    )
  } catch {
    // Ignore note-write failures after the primary benchmark error.
  }
}

function round(value: number, places = 2): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
