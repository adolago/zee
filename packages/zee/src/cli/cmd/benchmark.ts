import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Argv } from "yargs"
import { createZeeClient, type ZeeClient } from "@zee/sdk/v2"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { Provider } from "../../provider/provider"
import { Agent } from "../../agent/agent"
import { Server } from "../../server/server"
import { GlobalBus } from "../../bus/global"

export type BenchmarkModelRef = {
  providerID: string
  modelID: string
}

export type BenchmarkAppEvent = {
  type: string
  properties: any
}

export type BenchmarkRunStatus = "ok" | "invalid" | "error"
export type BenchmarkTokenSource = "reported" | "estimated_chars" | "missing"

export interface BenchmarkRunReport {
  index: number
  warmup: boolean
  model: string
  status: BenchmarkRunStatus
  firstActivityMs: number | null
  ttftMs: number | null
  totalMs: number
  outputTokens: number | null
  reasoningTokens: number | null
  tokenSource: BenchmarkTokenSource
  generationTokensPerSec: number | null
  effectiveTokensPerSec: number | null
  invalidReason?: string
  error?: string
}

export interface BenchmarkSummaryMetric {
  mean: number | null
  median: number | null
  min: number | null
  max: number | null
}

export interface BenchmarkModelSummary {
  requestedRuns: number
  warmupRuns: number
  validRuns: number
  invalidRuns: number
  errorRuns: number
  firstActivityMs: BenchmarkSummaryMetric
  ttftMs: BenchmarkSummaryMetric
  totalMs: BenchmarkSummaryMetric
  outputTokens: BenchmarkSummaryMetric
  generationTokensPerSec: BenchmarkSummaryMetric
  effectiveTokensPerSec: BenchmarkSummaryMetric
}

export interface BenchmarkModelReport {
  model: string
  runs: BenchmarkRunReport[]
  summary: BenchmarkModelSummary
}

export interface BenchmarkReport {
  generatedAt: string
  cwd: string
  options: {
    agent: string
    variant?: string
    runs: number
    warmup: number
    prompt: string
    models: string[]
  }
  models: BenchmarkModelReport[]
}

export interface BenchmarkAttempt {
  sessionID: string
  events: AsyncIterable<BenchmarkAppEvent>
  prompt(): Promise<void>
  rejectPermission(permissionID: string): Promise<void>
  cleanup(): Promise<void>
}

export interface BenchmarkRuntime {
  beginAttempt(input: {
    title: string
    agent: string
    model: BenchmarkModelRef
    variant?: string
    prompt: string
    system: string
  }): Promise<BenchmarkAttempt>
}

export type BenchmarkCommandArgs = {
  model?: string[]
  agent?: string
  variant?: string
  runs?: number
  warmup?: number
  prompt?: string
  json?: boolean
  output?: string
}

export interface BenchmarkCommandDeps {
  runtime: BenchmarkRuntime
  cwd?: string
  print?: (text: string) => void
  writeReportFile?: (filePath: string, contents: string) => Promise<void>
  resolveDefaultModel?: () => Promise<BenchmarkModelRef>
  validateModel?: (model: BenchmarkModelRef) => Promise<void>
  validateAgent?: (agent: string) => Promise<string>
}

type BenchmarkObservation = {
  firstActivityMs: number | null
  ttftMs: number | null
  totalMs: number
  outputTokens: number | null
  reasoningTokens: number | null
  tokenSource: BenchmarkTokenSource
  invalidReason?: string
  error?: string
}

const DEFAULT_AGENT = "zee"
const DEFAULT_RUNS = 3
const DEFAULT_WARMUP = 1
const DEFAULT_BENCHMARK_PROMPT =
  "Write a single plain-text paragraph of roughly 120 words about why consistent latency benchmarking matters for language models. Do not use markdown, bullets, lists, code fences, or tool calls."
const BENCHMARK_SYSTEM_PROMPT =
  "You are in Zee benchmark mode. Respond directly with plain text only. Never call tools. Never ask follow-up questions. Never use markdown. Return a single paragraph."
const BENCHMARK_PERMISSION_RULES = [
  { permission: "question", action: "deny" as const, pattern: "*" },
  { permission: "plan_enter", action: "deny" as const, pattern: "*" },
  { permission: "plan_exit", action: "deny" as const, pattern: "*" },
]

function modelLabel(model: BenchmarkModelRef): string {
  return `${model.providerID}/${model.modelID}`
}

function round(value: number, places = 2): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function estimateTokensFromChars(chars: number): number | null {
  if (!Number.isFinite(chars) || chars <= 0) return null
  return Math.max(1, Math.round(chars / 4))
}

function summarizeValues(values: number[]): BenchmarkSummaryMetric {
  if (values.length === 0) {
    return { mean: null, median: null, min: null, max: null }
  }

  const sorted = values.slice().sort((a, b) => a - b)
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : (sorted[middle] as number)

  return {
    mean: round(mean),
    median: round(median),
    min: round(sorted[0] as number),
    max: round(sorted[sorted.length - 1] as number),
  }
}

function resolveModels(input: string[] | undefined, fallback: BenchmarkModelRef): BenchmarkModelRef[] {
  const raw = (input ?? []).map((item) => item.trim()).filter(Boolean)
  if (raw.length === 0) return [fallback]

  const result: BenchmarkModelRef[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const parsed = Provider.parseModel(item)
    const label = modelLabel(parsed)
    if (seen.has(label)) continue
    seen.add(label)
    result.push(parsed)
  }
  return result
}

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a"
  if (value >= 1000) return `${round(value / 1000, 2)}s`
  return `${round(value, 1)}ms`
}

function formatMsMetric(metric: BenchmarkSummaryMetric): string {
  if (metric.mean === null) return "n/a"
  return `mean=${formatMs(metric.mean)} median=${formatMs(metric.median)} min=${formatMs(metric.min)} max=${formatMs(metric.max)}`
}

function formatNumber(value: number | null | undefined, places = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a"
  return round(value, places).toFixed(places)
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a"
  return `${Math.round(value)}`
}

function formatCountMetric(metric: BenchmarkSummaryMetric): string {
  if (metric.mean === null) return "n/a"
  return `mean=${formatCount(metric.mean)} median=${formatCount(metric.median)} min=${formatCount(metric.min)} max=${formatCount(metric.max)}`
}

function extractEventError(input: unknown): string {
  if (!input) return "Unknown error"
  if (typeof input === "string") return input
  if (typeof input === "object") {
    const record = input as Record<string, unknown>
    if (typeof record.message === "string" && record.message.length > 0) return record.message
    if (record.data && typeof record.data === "object") {
      const data = record.data as Record<string, unknown>
      if (typeof data.message === "string" && data.message.length > 0) return data.message
    }
    if (typeof record.name === "string" && record.name.length > 0) return record.name
  }
  return String(input)
}

function buildRunReport(params: {
  index: number
  warmup: boolean
  model: string
  observation: BenchmarkObservation
}): BenchmarkRunReport {
  const { index, warmup, model, observation } = params
  const generationWindowMs =
    observation.ttftMs !== null && observation.totalMs > observation.ttftMs
      ? observation.totalMs - observation.ttftMs
      : null
  const generationTokensPerSec =
    observation.outputTokens !== null && generationWindowMs && generationWindowMs > 0
      ? round(observation.outputTokens / (generationWindowMs / 1000))
      : null
  const effectiveTokensPerSec =
    observation.outputTokens !== null && observation.totalMs > 0
      ? round(observation.outputTokens / (observation.totalMs / 1000))
      : null

  return {
    index,
    warmup,
    model,
    status: observation.error ? "error" : observation.invalidReason ? "invalid" : "ok",
    firstActivityMs: observation.firstActivityMs,
    ttftMs: observation.ttftMs,
    totalMs: observation.totalMs,
    outputTokens: observation.outputTokens,
    reasoningTokens: observation.reasoningTokens,
    tokenSource: observation.tokenSource,
    generationTokensPerSec,
    effectiveTokensPerSec,
    invalidReason: observation.invalidReason,
    error: observation.error,
  }
}

export function summarizeBenchmarkRuns(
  runs: BenchmarkRunReport[],
  options: { requestedRuns: number; warmupRuns: number },
): BenchmarkModelSummary {
  const measuredRuns = runs.filter((run) => !run.warmup)
  const validRuns = measuredRuns.filter((run) => run.status === "ok")

  return {
    requestedRuns: options.requestedRuns,
    warmupRuns: options.warmupRuns,
    validRuns: validRuns.length,
    invalidRuns: measuredRuns.filter((run) => run.status === "invalid").length,
    errorRuns: measuredRuns.filter((run) => run.status === "error").length,
    firstActivityMs: summarizeValues(
      validRuns.map((run) => run.firstActivityMs).filter((value): value is number => typeof value === "number"),
    ),
    ttftMs: summarizeValues(validRuns.map((run) => run.ttftMs).filter((value): value is number => typeof value === "number")),
    totalMs: summarizeValues(validRuns.map((run) => run.totalMs)),
    outputTokens: summarizeValues(
      validRuns.map((run) => run.outputTokens).filter((value): value is number => typeof value === "number"),
    ),
    generationTokensPerSec: summarizeValues(
      validRuns
        .map((run) => run.generationTokensPerSec)
        .filter((value): value is number => typeof value === "number"),
    ),
    effectiveTokensPerSec: summarizeValues(
      validRuns.map((run) => run.effectiveTokensPerSec).filter((value): value is number => typeof value === "number"),
    ),
  }
}

export function renderBenchmarkReport(report: BenchmarkReport): string[] {
  const lines: string[] = []
  lines.push("Benchmark results")
  lines.push("")

  for (const model of report.models) {
    lines.push(`Model: ${model.model}`)
    lines.push("Run  Type     Status   First Activity  TTFT    Total   Out Tok  Gen Tok/s  Eff Tok/s  Notes")

    for (const run of model.runs) {
      const note = run.error ?? run.invalidReason ?? ""
      lines.push(
        [
          String(run.index).padEnd(4, " "),
          (run.warmup ? "warmup" : "measured").padEnd(8, " "),
          run.status.padEnd(8, " "),
          formatMs(run.firstActivityMs).padEnd(15, " "),
          formatMs(run.ttftMs).padEnd(7, " "),
          formatMs(run.totalMs).padEnd(7, " "),
          formatCount(run.outputTokens).padEnd(8, " "),
          formatNumber(run.generationTokensPerSec).padEnd(10, " "),
          formatNumber(run.effectiveTokensPerSec).padEnd(10, " "),
          note,
        ].join("  "),
      )
    }

    lines.push(
      `Summary: valid=${model.summary.validRuns}/${model.summary.requestedRuns} invalid=${model.summary.invalidRuns} errors=${model.summary.errorRuns}`,
    )
    lines.push(`First activity: ${formatMsMetric(model.summary.firstActivityMs)}`)
    lines.push(`TTFT: ${formatMsMetric(model.summary.ttftMs)}`)
    lines.push(`Total latency: ${formatMsMetric(model.summary.totalMs)}`)
    lines.push(`Output tokens: ${formatCountMetric(model.summary.outputTokens)}`)
    lines.push(
      `Generation tok/s: mean=${formatNumber(model.summary.generationTokensPerSec.mean)} median=${formatNumber(model.summary.generationTokensPerSec.median)} min=${formatNumber(model.summary.generationTokensPerSec.min)} max=${formatNumber(model.summary.generationTokensPerSec.max)}`,
    )
    lines.push(
      `Effective tok/s: mean=${formatNumber(model.summary.effectiveTokensPerSec.mean)} median=${formatNumber(model.summary.effectiveTokensPerSec.median)} min=${formatNumber(model.summary.effectiveTokensPerSec.min)} max=${formatNumber(model.summary.effectiveTokensPerSec.max)}`,
    )
    lines.push("")
  }

  if (report.models.length > 0) {
    lines.pop()
  }

  return lines
}

async function observeAttempt(attempt: BenchmarkAttempt, startedAt: number): Promise<BenchmarkObservation> {
  let firstActivityMs: number | null = null
  let ttftMs: number | null = null
  let outputTokens: number | null = null
  let reasoningTokens: number | null = null
  let tokenSource: BenchmarkTokenSource = "missing"
  let invalidReason: string | undefined
  let error: string | undefined
  let totalMs = 0
  let textChars = 0

  for await (const event of attempt.events) {
    switch (event.type) {
      case "message.part.updated": {
        const props = event.properties ?? {}
        const part = props.part
        const delta = props.delta
        if (!part || part.sessionID !== attempt.sessionID) break

        const nowMs = round(performance.now() - startedAt)
        if (part.type === "tool") {
          firstActivityMs ??= nowMs
          const toolName = typeof part.tool === "string" ? part.tool : "tool"
          invalidReason ??= `tool call: ${toolName}`
          break
        }

        const hasDelta = typeof delta === "string" && delta.length > 0
        if (hasDelta && (part.type === "reasoning" || part.type === "text")) {
          firstActivityMs ??= nowMs
        }

        if (part.type === "text" && hasDelta) {
          ttftMs ??= nowMs
          textChars += delta.length
        }

        if (part.type === "step-finish" && part.tokens) {
          const reportedOutput = Number(part.tokens.output)
          const reportedReasoning = Number(part.tokens.reasoning)
          outputTokens = Number.isFinite(reportedOutput) ? reportedOutput : outputTokens
          reasoningTokens = Number.isFinite(reportedReasoning) ? reportedReasoning : reasoningTokens
          if (outputTokens !== null) tokenSource = "reported"
        }
        break
      }

      case "permission.asked": {
        const permission = event.properties
        if (!permission || permission.sessionID !== attempt.sessionID) break
        invalidReason ??= `permission prompt: ${permission.permission ?? "unknown"}`
        await attempt.rejectPermission(permission.id).catch(() => {})
        break
      }

      case "session.error": {
        const props = event.properties
        if (!props || props.sessionID !== attempt.sessionID) break
        error = extractEventError(props.error)
        break
      }

      case "session.idle": {
        const props = event.properties
        if (!props || props.sessionID !== attempt.sessionID) break
        totalMs = round(performance.now() - startedAt)
        if (outputTokens === null) {
          outputTokens = estimateTokensFromChars(textChars)
          tokenSource = outputTokens === null ? "missing" : "estimated_chars"
        }
        return {
          firstActivityMs,
          ttftMs,
          totalMs,
          outputTokens,
          reasoningTokens,
          tokenSource,
          invalidReason,
          error,
        }
      }
    }
  }

  totalMs = round(performance.now() - startedAt)
  if (outputTokens === null) {
    outputTokens = estimateTokensFromChars(textChars)
    tokenSource = outputTokens === null ? "missing" : "estimated_chars"
  }

  return {
    firstActivityMs,
    ttftMs,
    totalMs,
    outputTokens,
    reasoningTokens,
    tokenSource,
    invalidReason,
    error,
  }
}

export async function runBenchmarkAttempt(input: {
  runtime: BenchmarkRuntime
  title: string
  index: number
  warmup: boolean
  agent: string
  model: BenchmarkModelRef
  variant?: string
  prompt: string
  system: string
}): Promise<BenchmarkRunReport> {
  const attempt = await input.runtime.beginAttempt({
    title: input.title,
    agent: input.agent,
    model: input.model,
    variant: input.variant,
    prompt: input.prompt,
    system: input.system,
  })

  const startedAt = performance.now()
  const observationPromise = observeAttempt(attempt, startedAt)

  try {
    await attempt.prompt()
    const observation = await observationPromise
    return buildRunReport({
      index: input.index,
      warmup: input.warmup,
      model: modelLabel(input.model),
      observation,
    })
  } catch (error) {
    return buildRunReport({
      index: input.index,
      warmup: input.warmup,
      model: modelLabel(input.model),
      observation: {
        firstActivityMs: null,
        ttftMs: null,
        totalMs: round(performance.now() - startedAt),
        outputTokens: null,
        reasoningTokens: null,
        tokenSource: "missing",
        error: error instanceof Error ? error.message : String(error),
      },
    })
  } finally {
    await attempt.cleanup().catch(() => {})
    await observationPromise.catch(() => {})
  }
}

export async function runBenchmarkSuite(input: {
  runtime: BenchmarkRuntime
  cwd: string
  agent: string
  models: BenchmarkModelRef[]
  variant?: string
  runs: number
  warmup: number
  prompt: string
  system: string
}): Promise<BenchmarkReport> {
  const models: BenchmarkModelReport[] = []
  const totalRuns = input.runs + input.warmup

  for (const model of input.models) {
    const runs: BenchmarkRunReport[] = []
    for (let index = 1; index <= totalRuns; index++) {
      const warmup = index <= input.warmup
      runs.push(
        await runBenchmarkAttempt({
          runtime: input.runtime,
          title: `Benchmark ${modelLabel(model)} run ${index}`,
          index,
          warmup,
          agent: input.agent,
          model,
          variant: input.variant,
          prompt: input.prompt,
          system: input.system,
        }),
      )
    }

    models.push({
      model: modelLabel(model),
      runs,
      summary: summarizeBenchmarkRuns(runs, {
        requestedRuns: input.runs,
        warmupRuns: input.warmup,
      }),
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    cwd: input.cwd,
    options: {
      agent: input.agent,
      variant: input.variant,
      runs: input.runs,
      warmup: input.warmup,
      prompt: input.prompt,
      models: input.models.map(modelLabel),
    },
    models,
  }
}

export async function executeBenchmarkCommand(
  args: BenchmarkCommandArgs,
  deps: BenchmarkCommandDeps,
): Promise<{ report: BenchmarkReport; exitCode: number }> {
  const cwd = deps.cwd ?? process.cwd()
  const print = deps.print ?? ((text: string) => process.stdout.write(text))
  const writeReportFile =
    deps.writeReportFile ??
    (async (filePath: string, contents: string) => {
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, contents)
    })

  const rawModels = (args.model ?? []).map((item) => item.trim()).filter(Boolean)
  const models =
    rawModels.length > 0
      ? resolveModels(rawModels, { providerID: "", modelID: "" })
      : resolveModels(
          rawModels,
          await (deps.resolveDefaultModel ?? (() => Provider.defaultModel()))(),
        )
  const validateModel = deps.validateModel ?? (async () => {})
  for (const model of models) {
    await validateModel(model)
  }

  const agent = await (deps.validateAgent ?? (async (value: string) => value))(args.agent ?? DEFAULT_AGENT)
  const runs = Math.max(1, Math.floor(args.runs ?? DEFAULT_RUNS))
  const warmup = Math.max(0, Math.floor(args.warmup ?? DEFAULT_WARMUP))
  const prompt = args.prompt?.trim() ? args.prompt.trim() : DEFAULT_BENCHMARK_PROMPT

  const report = await runBenchmarkSuite({
    runtime: deps.runtime,
    cwd,
    agent,
    models,
    variant: args.variant,
    runs,
    warmup,
    prompt,
    system: BENCHMARK_SYSTEM_PROMPT,
  })

  const json = JSON.stringify(report, null, 2) + "\n"
  if (args.output) {
    const outputPath = path.resolve(cwd, args.output)
    await writeReportFile(outputPath, json)
  }

  if (args.json) {
    print(json)
  } else {
    print(renderBenchmarkReport(report).join("\n") + "\n")
  }

  const exitCode = report.models.some((model) => model.summary.validRuns === 0) ? 1 : 0
  return { report, exitCode }
}

function resolveLocalAppEvent(input: any): BenchmarkAppEvent | undefined {
  if (!input || typeof input !== "object") return
  if (input.payload && typeof input.payload === "object") {
    const payload = input.payload as BenchmarkAppEvent
    if (typeof payload.type === "string") return payload
  }
  if (typeof input.type === "string") {
    return input as BenchmarkAppEvent
  }
}

function createLocalEventStream() {
  const queue: BenchmarkAppEvent[] = []
  let resolver: ((value: IteratorResult<BenchmarkAppEvent>) => void) | null = null
  let done = false

  const handler = (event: { payload: any }) => {
    const payload = resolveLocalAppEvent(event.payload)
    if (!payload) return
    if (resolver) {
      resolver({ value: payload, done: false })
      resolver = null
      return
    }
    queue.push(payload)
  }

  GlobalBus.on("event", handler)

  const iterator = {
    async next(): Promise<IteratorResult<BenchmarkAppEvent>> {
      if (done) return { value: undefined, done: true }
      if (queue.length > 0) {
        const value = queue.shift() as BenchmarkAppEvent
        return { value, done: false }
      }
      return await new Promise<IteratorResult<BenchmarkAppEvent>>((resolve) => {
        resolver = resolve
      })
    },
    async return(): Promise<IteratorResult<BenchmarkAppEvent>> {
      done = true
      GlobalBus.off("event", handler)
      if (resolver) {
        resolver({ value: undefined, done: true })
        resolver = null
      }
      return { value: undefined, done: true }
    },
  }

  return {
    events: {
      [Symbol.asyncIterator]() {
        return iterator
      },
    } satisfies AsyncIterable<BenchmarkAppEvent>,
    async close() {
      await iterator.return()
    },
  }
}

function createLocalRuntime(sdk: ZeeClient): BenchmarkRuntime {
  return {
    async beginAttempt(input) {
      const session = await sdk.session.create({
        title: input.title,
        permission: BENCHMARK_PERMISSION_RULES as any,
      })
      const sessionID = session.data?.id
      if (!sessionID) {
        throw new Error("Failed to create benchmark session")
      }

      const stream = createLocalEventStream()

      return {
        sessionID,
        events: stream.events,
        async prompt() {
          await sdk.session.prompt({
            sessionID,
            agent: input.agent,
            model: input.model,
            variant: input.variant,
            system: input.system,
            parts: [{ type: "text", text: input.prompt }],
          })
        },
        async rejectPermission(permissionID: string) {
          await sdk.permission.respond({
            sessionID,
            permissionID,
            response: "reject",
          })
        },
        async cleanup() {
          await stream.close()
          await sdk.session.delete({ sessionID }).catch(() => undefined)
        },
      }
    },
  }
}

async function validateAgent(agentName: string): Promise<string> {
  const agent = await Agent.get(agentName)
  if (!agent) {
    throw new Error(`Agent not found: ${agentName}`)
  }
  if (agent.mode === "subagent") {
    throw new Error(`Agent "${agentName}" is a subagent and cannot be used for benchmarks`)
  }
  return agentName
}

export const BenchmarkCommand = cmd({
  command: "benchmark",
  describe: "measure Zee token speed and latency (TTFT) for one or more models",
  builder: (yargs: Argv) =>
    yargs
      .option("model", {
        type: "string",
        array: true,
        describe: "model(s) to benchmark in provider/model format; repeat to compare multiple models",
      })
      .option("agent", {
        type: "string",
        default: DEFAULT_AGENT,
        describe: "agent to use for the benchmark prompt",
      })
      .option("variant", {
        type: "string",
        describe: "provider-specific model variant",
      })
      .option("runs", {
        type: "number",
        default: DEFAULT_RUNS,
        describe: "measured runs per model",
      })
      .option("warmup", {
        type: "number",
        default: DEFAULT_WARMUP,
        describe: "warmup runs per model (excluded from summaries)",
      })
      .option("prompt", {
        type: "string",
        describe: "custom benchmark prompt",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "print machine-readable JSON instead of the human summary",
      })
      .option("output", {
        type: "string",
        describe: "write the JSON report to a file",
      }),
  handler: async (args: BenchmarkCommandArgs) => {
    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.App().fetch(request)
      }) as typeof globalThis.fetch

      const sdk = createZeeClient({
        baseUrl: "http://zee.internal",
        fetch: fetchFn,
      })

      const result = await executeBenchmarkCommand(args, {
        runtime: createLocalRuntime(sdk),
        cwd: process.cwd(),
        validateModel: async (model) => {
          await Provider.getModel(model.providerID, model.modelID)
        },
        validateAgent,
      })

      if (result.exitCode !== 0) {
        process.exit(result.exitCode)
      }
    })
  },
})
