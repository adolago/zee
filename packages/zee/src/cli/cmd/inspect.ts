import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { SessionStatus } from "../../session/status"
import { collectRuntimeSnapshot } from "./runtime-process-guard"
import * as UsageStorage from "../../usage/storage"
import type { UsagePeriod, UsageStats, UsageSummary } from "../../usage/types"
import { buildUsageBreakdown, sortUsageBreakdown, type UsageBreakdownRow } from "./usage"
import { formatCost, formatTokens } from "../../usage/pricing"

type InspectStateArgs = {
  json?: boolean
}

type InspectOpsArgs = {
  json?: boolean
  usagePeriod?: string
  usageTop?: number
}

const USAGE_PERIODS = ["hour", "day", "week", "month", "all"] as const

type SessionQueueSnapshot = {
  sessions: {
    total: number
    roots: number
    children: number
  }
  queue: {
    totalTracked: number
    busy: number
    retry: number
  }
}

export type InspectUsageSnapshot = {
  period: UsagePeriod
  summary: UsageSummary
  stats: UsageStats
  topProviders: UsageBreakdownRow[]
  topModels: UsageBreakdownRow[]
}

export function resolveInspectUsagePeriod(raw: string | undefined, fallback: UsagePeriod): UsagePeriod {
  return (USAGE_PERIODS as readonly string[]).includes(raw ?? "") ? (raw as UsagePeriod) : fallback
}

export function resolveInspectUsageTop(raw: number | undefined, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback
  return Math.max(1, Math.floor(raw))
}

export function buildInspectUsageSnapshot(params: {
  period: UsagePeriod
  summary: UsageSummary
  stats: UsageStats
  top: number
}): InspectUsageSnapshot {
  const topProviders = sortUsageBreakdown(buildUsageBreakdown(params.summary, "provider"), "cost").slice(0, params.top)
  const topModels = sortUsageBreakdown(buildUsageBreakdown(params.summary, "model"), "cost").slice(0, params.top)

  return {
    period: params.period,
    summary: params.summary,
    stats: params.stats,
    topProviders,
    topModels,
  }
}

async function gatherSessionQueueSnapshot(): Promise<SessionQueueSnapshot> {
  const sessions = [] as Session.Info[]
  for await (const session of Session.list()) {
    sessions.push(session)
  }

  const statusBySession = SessionStatus.list()
  const statusSummary = {
    totalTracked: Object.keys(statusBySession).length,
    busy: Object.values(statusBySession).filter((status) => status.type === "busy").length,
    retry: Object.values(statusBySession).filter((status) => status.type === "retry").length,
  }

  return {
    sessions: {
      total: sessions.length,
      roots: sessions.filter((session) => !session.parentID).length,
      children: sessions.filter((session) => Boolean(session.parentID)).length,
    },
    queue: statusSummary,
  }
}

async function gatherUsageSnapshot(params: { period: UsagePeriod; top: number }): Promise<InspectUsageSnapshot> {
  await UsageStorage.init()
  try {
    const summary = UsageStorage.getSummary({ period: params.period })
    const stats = UsageStorage.getStats()
    return buildInspectUsageSnapshot({
      period: params.period,
      summary,
      stats,
      top: params.top,
    })
  } finally {
    await UsageStorage.close()
  }
}

const InspectStateCommand = cmd({
  command: "state",
  describe: "print a machine-readable runtime/session snapshot",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      type: "boolean",
      default: true,
      describe: "output as JSON",
    }),
  handler: async (args: InspectStateArgs) => {
    const runtime = await collectRuntimeSnapshot()

    await bootstrap(process.cwd(), async () => {
      const sessionQueue = await gatherSessionQueueSnapshot()

      const payload = {
        generatedAt: new Date().toISOString(),
        runtime,
        sessions: sessionQueue.sessions,
        queue: sessionQueue.queue,
      }

      if (args.json !== false) {
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      console.log(
        `runtime total=${runtime.counts.total} mcp=${runtime.counts.mcpServers} clients=${runtime.counts.clients}`,
      )
      console.log(
        `sessions total=${payload.sessions.total} roots=${payload.sessions.roots} children=${payload.sessions.children}`,
      )
      console.log(`queue tracked=${payload.queue.totalTracked} busy=${payload.queue.busy} retry=${payload.queue.retry}`)
      if (runtime.violations.length > 0) {
        console.log("violations:")
        for (const violation of runtime.violations) {
          console.log(`- ${violation}`)
        }
      }
    })
  },
})

const InspectOpsCommand = cmd({
  command: "ops",
  describe: "print consolidated ops report (runtime, sessions, queue, usage)",
  builder: (yargs: Argv) =>
    yargs
      .option("json", {
        type: "boolean",
        default: true,
        describe: "output as JSON",
      })
      .option("usage-period", {
        type: "string",
        choices: USAGE_PERIODS,
        default: "day",
        describe: "usage aggregation period",
      })
      .option("usage-top", {
        type: "number",
        default: 5,
        describe: "top providers/models to include",
      }),
  handler: async (args: InspectOpsArgs) => {
    const usagePeriod = resolveInspectUsagePeriod(args.usagePeriod, "day")
    const usageTop = resolveInspectUsageTop(args.usageTop, 5)
    const runtime = await collectRuntimeSnapshot()

    await bootstrap(process.cwd(), async () => {
      const [sessionQueue, usage] = await Promise.all([
        gatherSessionQueueSnapshot(),
        gatherUsageSnapshot({ period: usagePeriod, top: usageTop }),
      ])

      const payload = {
        generatedAt: new Date().toISOString(),
        runtime,
        sessions: sessionQueue.sessions,
        queue: sessionQueue.queue,
        usage,
      }

      if (args.json !== false) {
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      console.log(
        `runtime total=${runtime.counts.total} mcp=${runtime.counts.mcpServers} clients=${runtime.counts.clients}`,
      )
      console.log(
        `sessions total=${payload.sessions.total} roots=${payload.sessions.roots} children=${payload.sessions.children}`,
      )
      console.log(`queue tracked=${payload.queue.totalTracked} busy=${payload.queue.busy} retry=${payload.queue.retry}`)
      console.log(
        `usage period=${usage.period} requests=${usage.summary.totalRequests} tokens=${formatTokens(usage.summary.totalInputTokens + usage.summary.totalOutputTokens)} cost=${formatCost(usage.summary.totalCost)}`,
      )

      if (usage.topProviders.length > 0) {
        console.log("top providers:")
        for (const provider of usage.topProviders) {
          console.log(
            `- ${provider.id} requests=${provider.requests} tokens=${formatTokens(provider.tokens)} cost=${formatCost(provider.cost)}`,
          )
        }
      }

      if (usage.topModels.length > 0) {
        console.log("top models:")
        for (const model of usage.topModels) {
          const prefix = model.providerId ? `${model.providerId}/` : ""
          console.log(
            `- ${prefix}${model.id} requests=${model.requests} tokens=${formatTokens(model.tokens)} cost=${formatCost(model.cost)}`,
          )
        }
      }

      if (runtime.violations.length > 0) {
        console.log("violations:")
        for (const violation of runtime.violations) {
          console.log(`- ${violation}`)
        }
      }
    })
  },
})

export const InspectCommand = cmd({
  command: "inspect",
  describe: "inspect runtime state",
  builder: (yargs: Argv) => yargs.command(InspectStateCommand).command(InspectOpsCommand).demandCommand(),
  async handler() {},
})
