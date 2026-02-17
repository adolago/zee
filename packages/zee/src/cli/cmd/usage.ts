import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as UsageStorage from "../../usage/storage"
import { formatCost, formatTokens } from "../../usage/pricing"
import type { UsagePeriod, UsageStats, UsageSummary } from "../../usage/types"

const PERIODS = ["hour", "day", "week", "month", "all"] as const
const BREAKDOWN_BY = ["model", "provider"] as const
const SORT_BY = ["cost", "tokens", "requests"] as const

type UsageBreakdownBy = (typeof BREAKDOWN_BY)[number]
type UsageSortBy = (typeof SORT_BY)[number]

type UsageDashboardArgs = {
  period?: string
  top?: number
  json?: boolean
}

type UsageTopArgs = {
  period?: string
  by?: string
  sort?: string
  limit?: number
  json?: boolean
}

export type UsageBreakdownRow = {
  id: string
  providerId?: string
  modelName?: string
  requests: number
  tokens: number
  cost: number
  avgLatencyMs?: number
}

export function buildUsageBreakdown(summary: UsageSummary, by: UsageBreakdownBy): UsageBreakdownRow[] {
  if (by === "provider") {
    return Object.values(summary.byProvider).map((provider) => ({
      id: provider.providerId,
      requests: provider.requests,
      tokens: provider.inputTokens + provider.outputTokens,
      cost: provider.cost,
    }))
  }

  return Object.values(summary.byModel).map((model) => ({
    id: model.modelId,
    providerId: model.providerId,
    modelName: model.modelName,
    requests: model.requests,
    tokens: model.inputTokens + model.outputTokens,
    cost: model.cost,
    avgLatencyMs: model.avgLatencyMs,
  }))
}

export function sortUsageBreakdown(rows: UsageBreakdownRow[], sortBy: UsageSortBy): UsageBreakdownRow[] {
  const list = rows.slice()
  list.sort((a, b) => {
    switch (sortBy) {
      case "requests":
        if (b.requests !== a.requests) return b.requests - a.requests
        break
      case "tokens":
        if (b.tokens !== a.tokens) return b.tokens - a.tokens
        break
      case "cost":
      default:
        if (b.cost !== a.cost) return b.cost - a.cost
        break
    }

    if (b.requests !== a.requests) return b.requests - a.requests
    return a.id.localeCompare(b.id)
  })
  return list
}

export function renderUsageDashboardLines(params: {
  period: UsagePeriod
  summary: UsageSummary
  stats: UsageStats
  topProviders: UsageBreakdownRow[]
  topModels: UsageBreakdownRow[]
}): string[] {
  const { period, summary, stats, topProviders, topModels } = params
  const lines: string[] = []

  lines.push(`Usage dashboard (period=${period})`)
  lines.push(
    `Total: requests=${summary.totalRequests} tokens=${formatTokens(summary.totalInputTokens + summary.totalOutputTokens)} cost=${formatCost(summary.totalCost)}`,
  )
  lines.push(
    `Quality: avg_latency=${Math.round(summary.avgLatencyMs)}ms errors=${summary.errorCount} (${(summary.errorRate * 100).toFixed(1)}%) cache_hit=${(summary.cacheHitRate * 100).toFixed(1)}%`,
  )
  lines.push("")

  lines.push("Quick window snapshot:")
  lines.push(
    `- today: requests=${stats.todayRequests} tokens=${formatTokens(stats.todayTokens)} cost=${formatCost(stats.todayCost)}`,
  )
  lines.push(`- week: requests=${stats.weekRequests} cost=${formatCost(stats.weekCost)}`)
  lines.push(`- month: requests=${stats.monthRequests} cost=${formatCost(stats.monthCost)}`)
  if (stats.lastRequestAt) {
    lines.push(`- last_request: ${new Date(stats.lastRequestAt).toISOString()}`)
  }
  lines.push("")

  lines.push("Top providers:")
  if (topProviders.length === 0) {
    lines.push("- none")
  } else {
    for (const row of topProviders) {
      lines.push(
        `- ${row.id}: requests=${row.requests} tokens=${formatTokens(row.tokens)} cost=${formatCost(row.cost)}`,
      )
    }
  }
  lines.push("")

  lines.push("Top models:")
  if (topModels.length === 0) {
    lines.push("- none")
  } else {
    for (const row of topModels) {
      const provider = row.providerId ? `${row.providerId}/` : ""
      lines.push(
        `- ${provider}${row.id}: requests=${row.requests} tokens=${formatTokens(row.tokens)} cost=${formatCost(row.cost)}`,
      )
    }
  }

  return lines
}

function resolveUsagePeriod(raw: string | undefined, fallback: UsagePeriod): UsagePeriod {
  return (PERIODS as readonly string[]).includes(raw ?? "") ? (raw as UsagePeriod) : fallback
}

function resolveBreakdownBy(raw: string | undefined): UsageBreakdownBy {
  return (BREAKDOWN_BY as readonly string[]).includes(raw ?? "") ? (raw as UsageBreakdownBy) : "model"
}

function resolveSortBy(raw: string | undefined): UsageSortBy {
  return (SORT_BY as readonly string[]).includes(raw ?? "") ? (raw as UsageSortBy) : "cost"
}

async function withUsageStorage<T>(fn: () => Promise<T>): Promise<T> {
  await UsageStorage.init()
  try {
    return await fn()
  } finally {
    await UsageStorage.close()
  }
}

const UsageTopCommand = cmd({
  command: "top",
  describe: "show top usage rows by cost, tokens, or requests",
  builder: (yargs: Argv) =>
    yargs
      .option("period", {
        type: "string",
        choices: PERIODS,
        default: "month",
        describe: "aggregation period",
      })
      .option("by", {
        type: "string",
        choices: BREAKDOWN_BY,
        default: "model",
        describe: "breakdown target",
      })
      .option("sort", {
        type: "string",
        choices: SORT_BY,
        default: "cost",
        describe: "sort metric",
      })
      .option("limit", {
        type: "number",
        default: 10,
        describe: "rows to display",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      }),
  handler: async (args: UsageTopArgs) => {
    const by = resolveBreakdownBy(args.by)
    const sort = resolveSortBy(args.sort)
    const limit = Number.isFinite(args.limit) ? Math.max(1, Math.floor(args.limit ?? 10)) : 10
    const period = resolveUsagePeriod(args.period, "month")

    await withUsageStorage(async () => {
      const summary = UsageStorage.getSummary({ period })
      const rows = sortUsageBreakdown(buildUsageBreakdown(summary, by), sort).slice(0, limit)

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              period,
              by,
              sort,
              limit,
              totalRows: rows.length,
              rows,
            },
            null,
            2,
          ),
        )
        return
      }

      console.log(`Top usage (period=${period}, by=${by}, sort=${sort}, limit=${limit})`)
      if (rows.length === 0) {
        console.log("No usage rows found")
        return
      }

      for (const row of rows) {
        const prefix = by === "model" && row.providerId ? `${row.providerId}/` : ""
        console.log(
          `${prefix}${row.id} requests=${row.requests} tokens=${formatTokens(row.tokens)} cost=${formatCost(row.cost)}`,
        )
      }
    })
  },
})

export const UsageCommand = cmd({
  command: "usage",
  describe: "show usage dashboard and cost/token leaders",
  builder: (yargs: Argv) =>
    yargs
      .option("period", {
        type: "string",
        choices: PERIODS,
        default: "day",
        describe: "dashboard period",
      })
      .option("top", {
        type: "number",
        default: 5,
        describe: "top providers/models to include in dashboard",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "output as JSON",
      })
      .command(UsageTopCommand),
  handler: async (args: UsageDashboardArgs) => {
    const period = resolveUsagePeriod(args.period, "day")
    const top = Number.isFinite(args.top) ? Math.max(1, Math.floor(args.top ?? 5)) : 5

    await withUsageStorage(async () => {
      const summary = UsageStorage.getSummary({ period })
      const stats = UsageStorage.getStats()

      const topProviders = sortUsageBreakdown(buildUsageBreakdown(summary, "provider"), "cost").slice(0, top)
      const topModels = sortUsageBreakdown(buildUsageBreakdown(summary, "model"), "cost").slice(0, top)

      const payload = {
        generatedAt: new Date().toISOString(),
        period,
        top,
        summary,
        stats,
        topProviders,
        topModels,
      }

      if (args.json) {
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      for (const line of renderUsageDashboardLines({ period, summary, stats, topProviders, topModels })) {
        console.log(line)
      }
    })
  },
})
