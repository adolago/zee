/**
 * Investing Domain Tools
 *
 * Financial research and market analysis tools powered by:
 * - OpenBB Platform for market data
 * - NautilusTrader for algorithmic trading
 * - SEC EDGAR for regulatory filings
 */

import { z } from "zod"
import { existsSync, readFileSync } from "node:fs"
import type { ToolDefinition, ToolRuntime, ToolExecutionContext, ToolExecutionResult } from "../../mcp/types"
import { Investing } from "../../paths"
import { scratchpadTool } from "./scratchpad"
import { getResearchContextManager, resetResearchContextManager } from "./research-context"
import {
  INVESTING_RESEARCH_PLAN_STATUSES,
  INVESTING_RESEARCH_TASK_STATUSES,
  INVESTING_RESEARCH_WORKFLOW_KINDS,
  createInvestingResearchPlan,
  getInvestingResearchPlan,
  listInvestingResearchPlans,
  updateInvestingResearchTask,
} from "./planner"
import {
  getInvestingResearchExecution,
  listInvestingResearchExecutions,
  runInvestingResearchExecution,
} from "./executor"
import {
  INVESTING_RESEARCH_ARTIFACT_STATUSES,
  createInvestingResearchArtifact,
  getInvestingResearchArtifact,
  listInvestingResearchArtifacts,
} from "./artifacts"
import { getInvestingValuationKernel, listInvestingValuationKernels, runInvestingValuationKernel } from "./valuation"
import {
  createInvestingValuationPacket,
  exportInvestingValuationPacket,
  getInvestingValuationPacket,
  listInvestingValuationPackets,
} from "./valuation-packet"
import {
  createInvestingEarningsPacket,
  exportInvestingEarningsPacket,
  getInvestingEarningsPacket,
  INVESTING_EARNINGS_PACKET_WORKFLOWS,
  listInvestingEarningsPackets,
} from "./earnings-packets"
import {
  createInvestingEvalDataset,
  getInvestingEvalDataset,
  getInvestingEvalRun,
  INVESTING_EVAL_RUN_STATUSES,
  INVESTING_EVAL_SOURCE_KINDS,
  listInvestingEvalDatasets,
  listInvestingEvalRuns,
  runInvestingEvalDataset,
} from "./evals"
import {
  INVESTING_PORTFOLIO_BRIEFING_KINDS,
  createInvestingPortfolioBriefing,
  getInvestingPortfolioBriefing,
  getInvestingPortfolioBriefingStateFile,
  listInvestingPortfolioBriefings,
} from "./briefings"
import { INVESTING_THESIS_CONVICTIONS, INVESTING_THESIS_POSTURES, INVESTING_THESIS_RECORD_STATUSES } from "./thesis"
import {
  INVESTING_THESIS_PORTFOLIO_ROLLUP_AUDIENCES,
  buildInvestingThesisPortfolioRollup,
  diffInvestingThesisHistory,
  getInvestingThesisHistory,
  queryInvestingThesisRecord,
  queryInvestingTheses,
} from "./thesis-queries"
import {
  createInvestingOpsSchedule,
  getInvestingOpsDeliveryRecord,
  getInvestingOpsSchedule,
  INVESTING_OPS_DELIVERY_TARGETS,
  INVESTING_OPS_FORMATS,
  INVESTING_OPS_WORKFLOWS,
  listInvestingOpsDeliveryRecords,
  listInvestingOpsSchedules,
  runInvestingOpsSchedule,
  updateInvestingOpsSchedule,
} from "./ops-automation"
import {
  INVESTING_EVENT_CLASSIFICATIONS,
  INVESTING_EVENT_CONNECTORS,
  INVESTING_EVENT_DIRECTIONS,
  INVESTING_EVENT_MATERIALITY_BANDS,
  getInvestingEvent,
  getInvestingEventCatalogStatus,
  listInvestingEvents,
} from "../../../packages/zee/src/investing/events"

type InvestingResult = {
  ok: boolean
  command?: string
  data?: unknown
  error?: string
}

type InvestingEnvelope<T> = {
  success: boolean
  data: T | null
  error: string | null
  timestamp: string
}

type PortfolioPosition = {
  symbol: string
  shares: number
  averageCost: number
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) return undefined
  return args[index + 1]
}

function loadPortfolioHoldings(): Array<{ symbol: string; shares: number; average_cost: number }> {
  const portfolioFile = Investing.portfolioFile()
  if (!existsSync(portfolioFile)) return []

  try {
    const parsed = JSON.parse(readFileSync(portfolioFile, "utf8")) as any
    const positions = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.positions) ? parsed.positions : []

    return positions
      .map((position: any): PortfolioPosition | null => {
        const symbol = typeof position?.symbol === "string" ? normalizeSymbol(position.symbol) : ""
        const shares = Number(position?.shares ?? 0)
        const averageCost = Number(
          position?.averageCost ??
            position?.average_cost ??
            position?.avg_cost ??
            position?.entryPrice ??
            position?.entry_price ??
            position?.price ??
            0,
        )
        if (!symbol || !Number.isFinite(shares) || shares <= 0) return null
        return { symbol, shares, averageCost }
      })
      .filter((position: PortfolioPosition | null): position is PortfolioPosition => Boolean(position))
      .map((position: PortfolioPosition) => ({
        symbol: position.symbol,
        shares: position.shares,
        average_cost: position.averageCost,
      }))
  } catch {
    return []
  }
}

async function requestInvesting(pathname: string, init?: RequestInit): Promise<InvestingResult> {
  try {
    const baseUrl = Investing.apiUrl().replace(/\/+$/, "")
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    const text = await response.text()
    const payload = text ? (JSON.parse(text) as InvestingEnvelope<unknown> | unknown) : null

    if (payload && typeof payload === "object" && "success" in payload && "data" in payload) {
      const envelope = payload as InvestingEnvelope<unknown>
      if (!response.ok || !envelope.success) {
        return {
          ok: false,
          error: envelope.error || `Investing request failed with status ${response.status}`,
        }
      }
      return { ok: true, data: envelope.data }
    }

    if (!response.ok) {
      return {
        ok: false,
        error: text || `Investing request failed with status ${response.status}`,
      }
    }

    return { ok: true, data: payload }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runInvestingCli(args: string[]): Promise<InvestingResult> {
  const [domain, action] = args

  if (domain === "status") {
    return requestInvesting("/api/health")
  }

  if (domain === "market") {
    const symbol = normalizeSymbol(args[2] || "")
    if (!symbol) {
      return { ok: false, error: "A market symbol is required." }
    }
    if (action === "chart") {
      const period = flagValue(args, "--period") || "1mo"
      return requestInvesting(`/api/market/${symbol}/history?period=${encodeURIComponent(period)}&interval=1d`)
    }
    if (action === "segments") {
      return {
        ok: true,
        data: {
          symbol,
          segmentType: flagValue(args, "--type") || "business",
          note: "Segment detail is not yet exposed on the Rust investing HTTP surface.",
        },
      }
    }
    if (action === "fundamentals") {
      return requestInvesting(`/api/market/${symbol}`)
    }
    return requestInvesting(`/api/market/${symbol}/quote`)
  }

  if (domain === "portfolio") {
    const holdings = loadPortfolioHoldings()
    if (action === "status") {
      return {
        ok: true,
        data: {
          holdings,
          totalValue: holdings.reduce((total, holding) => total + holding.shares * holding.average_cost, 0),
        },
      }
    }
    if (action === "risk") {
      return requestInvesting("/api/portfolio/risk", {
        method: "POST",
        body: JSON.stringify({
          holdings,
          confidence_level: 0.95,
          method: "historical",
        }),
      })
    }
    if (action === "performance") {
      return requestInvesting("/api/portfolio/analytics", {
        method: "POST",
        body: JSON.stringify({ holdings, benchmark: "SPY" }),
      })
    }
  }

  if (domain === "research") {
    if (action === "analyze") {
      const symbol = normalizeSymbol(flagValue(args, "--ticker") || args[2] || "")
      return requestInvesting(`/api/research/${symbol}`)
    }
    if (action === "sec") {
      const symbol = normalizeSymbol(args[2] || "")
      return requestInvesting(`/api/accounting/${symbol}/filings`)
    }
    if (action === "screen") {
      const query = flagValue(args, "--criteria") || ""
      if (/^[A-Za-z.\-]{1,12}$/.test(query.trim())) {
        return requestInvesting(`/api/research/${normalizeSymbol(query)}`)
      }
      return {
        ok: true,
        data: {
          query,
          results: [],
          note: "Broad research screening is not yet exposed on the Rust investing HTTP surface.",
        },
      }
    }
    if (action === "estimates") {
      const symbol = normalizeSymbol(args[2] || "")
      return requestInvesting(`/api/valuation/${symbol}`)
    }
    if (action === "insider-trades") {
      const symbol = normalizeSymbol(args[2] || "")
      return requestInvesting(`/api/institutional/${symbol}/smart-money-flow`)
    }
  }

  if (domain === "nautilus") {
    if (action === "backtest") {
      const symbol = normalizeSymbol((flagValue(args, "--symbols") || "").split(",")[0] || "SPY")
      return requestInvesting("/api/signals/backtest", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          strategy: args[2] || "momentum",
          start_date: flagValue(args, "--start") || "2025-01-01",
          end_date: flagValue(args, "--end") || "2025-12-31",
          holding_period_days: 10,
          initial_capital: 100000,
        }),
      })
    }
    return {
      ok: true,
      data: {
        action,
        note: "This Nautilus action is not yet exposed on the Rust investing HTTP surface.",
      },
    }
  }

  return {
    ok: false,
    error: `Unsupported investing command: ${args.join(" ")}`,
  }
}

function renderOutput(title: string, result: InvestingResult): ToolExecutionResult {
  if (!result.ok) {
    return {
      title,
      metadata: { ok: false },
      output: result.error || "Investing CLI failed.",
    }
  }

  return {
    title,
    metadata: { ok: true },
    output: JSON.stringify(result.data ?? result, null, 2),
  }
}

// =============================================================================
// Deduplication Wrapper
// =============================================================================

/**
 * Wrap an investing tool's execute function with research-session deduplication.
 * If the same toolId+args were already called in this session, returns the cached result.
 */
function withDeduplication(
  toolId: string,
  execute: (args: any, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>,
): (args: any, ctx: ToolExecutionContext) => Promise<ToolExecutionResult> {
  return async (args, ctx) => {
    const manager = getResearchContextManager()

    if (manager.isDuplicate(toolId, args)) {
      const cached = manager.getCachedResult(toolId, args)!
      return {
        title: `[Cached] ${toolId}`,
        metadata: { cached: true, originalTimestamp: cached.timestamp },
        output: cached.fullOutput,
      }
    }

    const result = await execute(args, ctx)
    manager.record(toolId, args, result.output)
    return result
  }
}

export { resetResearchContextManager }

// =============================================================================
// Market Data Tool
// =============================================================================

const MarketDataParams = z.object({
  symbol: z.string().describe("Stock ticker symbol (e.g., AAPL, MSFT)"),
  dataType: z
    .enum(["quote", "chart", "fundamentals", "news"])
    .default("quote")
    .describe("Type of market data to retrieve"),
  period: z
    .enum(["1d", "5d", "1m", "3m", "6m", "1y", "ytd", "max"])
    .default("1m")
    .describe("Time period for historical data"),
  interval: z.enum(["1m", "5m", "15m", "1h", "1d", "1w"]).optional().describe("Data interval for charts"),
})

export const marketDataTool: ToolDefinition = {
  id: "zee:invest-market-data",
  category: "domain",
  init: async () => ({
    description: `Retrieve real-time and historical market data for stocks, ETFs, and indices. Data types: quote (current price), chart (historical), fundamentals (P/E, market cap), news.`,
    parameters: MarketDataParams,
    execute: withDeduplication("zee:invest-market-data", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, dataType, period } = args

      ctx.metadata({ title: `Fetching ${dataType} for ${symbol}` })

      if (dataType === "news") {
        return {
          title: `Market Data: ${symbol}`,
          metadata: { symbol, dataType },
          output: "News is not available in the Investing CLI yet.",
        }
      }

      const cliArgs =
        dataType === "chart"
          ? ["market", "chart", symbol, "--period", period]
          : dataType === "fundamentals"
            ? ["market", "fundamentals", symbol]
            : ["market", "quote", symbol]
      const result = await runInvestingCli(cliArgs)
      return renderOutput(`Market Data: ${symbol}`, result)
    }),
  }),
}

// =============================================================================
// Portfolio Analysis Tool
// =============================================================================

const PortfolioParams = z.object({
  action: z.enum(["get", "analyze", "optimize", "backtest"]).default("analyze").describe("Portfolio action to perform"),
  portfolioId: z.string().optional().describe("Portfolio identifier (uses default if not specified)"),
  benchmark: z.string().default("SPY").describe("Benchmark symbol for comparison"),
  riskMetrics: z.boolean().default(true).describe("Include risk metrics (Sharpe, Sortino, VaR)"),
})

export const portfolioTool: ToolDefinition = {
  id: "zee:invest-portfolio",
  category: "domain",
  init: async () => ({
    description: `Analyze and optimize investment portfolios. Check memory for user positions first. Actions: get (current), analyze (performance + risk metrics), optimize, backtest.`,
    parameters: PortfolioParams,
    execute: withDeduplication("zee:invest-portfolio", async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, portfolioId, benchmark, riskMetrics } = args

      ctx.metadata({ title: `Portfolio ${action}` })

      if (action === "optimize") {
        return {
          title: "Portfolio Analysis",
          metadata: { action, portfolioId: portfolioId || "default", benchmark, riskMetrics },
          output: "Portfolio optimization is not available in the Investing CLI yet.",
        }
      }

      if (action === "backtest") {
        return {
          title: "Portfolio Analysis",
          metadata: { action, portfolioId: portfolioId || "default", benchmark, riskMetrics },
          output: "Portfolio backtests should use the Nautilus tool with a strategy.",
        }
      }

      const cliArgs =
        action === "get"
          ? ["portfolio", "status"]
          : riskMetrics
            ? ["portfolio", "risk", "--var", "0.95"]
            : ["portfolio", "performance", "--period", "ytd"]
      const result = await runInvestingCli(cliArgs)
      return renderOutput("Portfolio Analysis", result)
    }),
  }),
}

// =============================================================================
// SEC Filings Tool
// =============================================================================

const SecFilingsParams = z.object({
  ticker: z.string().describe("Company ticker symbol"),
  formType: z
    .enum(["10-K", "10-Q", "8-K", "13F", "DEF14A", "S-1", "all"])
    .default("10-K")
    .describe("SEC form type to retrieve"),
  year: z.number().optional().describe("Filing year (defaults to most recent)"),
  summarize: z.boolean().default(true).describe("Generate AI summary of the filing"),
})

export const secFilingsTool: ToolDefinition = {
  id: "zee:invest-sec-filings",
  category: "domain",
  init: async () => ({
    description: `Access and analyze SEC regulatory filings. Form types: 10-K (annual), 10-Q (quarterly), 8-K (events), 13F (holdings), DEF14A (proxy), S-1 (IPO). Set summarize=true for AI summary.`,
    parameters: SecFilingsParams,
    execute: withDeduplication("zee:invest-sec-filings", async (args, ctx): Promise<ToolExecutionResult> => {
      const { ticker, formType, year, summarize } = args

      ctx.metadata({ title: `SEC ${formType} for ${ticker}` })

      const cliArgs = summarize
        ? ["research", "analyze", ticker, "--filing", formType]
        : ["research", "sec", ticker, "--type", formType]
      const result = await runInvestingCli(cliArgs)
      const response = renderOutput(`SEC Filing: ${ticker} ${formType}`, result)
      response.metadata = { ...response.metadata, ticker, formType, year }
      return response
    }),
  }),
}

// =============================================================================
// Research Tool
// =============================================================================

const ResearchParams = z.object({
  query: z.string().describe("Research query or topic"),
  sources: z
    .array(z.enum(["sec", "news", "analyst", "academic", "all"]))
    .default(["news", "analyst"])
    .describe("Sources to search"),
  dateRange: z.enum(["1d", "1w", "1m", "3m", "1y", "all"]).default("1m").describe("Date range for results"),
  limit: z.number().default(10).describe("Maximum number of results"),
})

export const researchTool: ToolDefinition = {
  id: "zee:invest-research",
  category: "domain",
  init: async () => ({
    description: `Conduct financial research across multiple sources (SEC, news, analyst, academic). Check memory for previous analyses first. Specify dateRange and limit for results.`,
    parameters: ResearchParams,
    execute: withDeduplication("zee:invest-research", async (args, ctx): Promise<ToolExecutionResult> => {
      const { query, sources, dateRange, limit } = args

      ctx.metadata({ title: `Researching: ${query}` })

      const result = await runInvestingCli(["research", "screen", "--criteria", query])
      const response = renderOutput(`Research: ${query}`, result)
      response.metadata = { ...response.metadata, sources, dateRange, limit }
      return response
    }),
  }),
}

const ResearchPlannerParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    objective: z.string().describe("Research objective to decompose into a repeatable workflow"),
    workflow: z.enum(INVESTING_RESEARCH_WORKFLOW_KINDS).optional().describe("Optional workflow override"),
    symbols: z.array(z.string()).optional().describe("Ticker symbols in scope for the workflow"),
  }),
  z.object({
    action: z.literal("read"),
    planId: z.string().describe("Persisted research plan identifier"),
  }),
  z.object({
    action: z.literal("list"),
    status: z.enum(INVESTING_RESEARCH_PLAN_STATUSES).optional().describe("Optional plan status filter"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of plans to return"),
  }),
  z.object({
    action: z.literal("update"),
    planId: z.string().describe("Persisted research plan identifier"),
    taskId: z.string().describe("Task identifier within the plan"),
    status: z.enum(INVESTING_RESEARCH_TASK_STATUSES).describe("Next status for the task"),
    note: z.string().optional().describe("Optional operator note or execution result"),
  }),
])

export const researchPlannerTool: ToolDefinition = {
  id: "zee:invest-planner",
  category: "domain",
  init: async () => ({
    description: `Create and manage repeatable multi-step investing research workflows. Use create before a complex Stanley-style analysis, read to reload a plan, list to inspect active work, and update as tasks progress.`,
    parameters: ResearchPlannerParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "create": {
          ctx.metadata({ title: `Planning research workflow: ${args.objective.slice(0, 48)}` })
          const plan = createInvestingResearchPlan({
            objective: args.objective,
            workflow: args.workflow,
            symbols: args.symbols,
          })
          return {
            title: "Investing Research Planner",
            metadata: { action: args.action, planId: plan.id, workflow: plan.workflow },
            output: JSON.stringify(plan, null, 2),
          }
        }
        case "read": {
          ctx.metadata({ title: `Loading research plan ${args.planId}` })
          const plan = getInvestingResearchPlan(args.planId)
          return {
            title: "Investing Research Planner",
            metadata: { action: args.action, planId: args.planId, found: Boolean(plan) },
            output: JSON.stringify(plan ?? { error: `Research plan not found: ${args.planId}` }, null, 2),
          }
        }
        case "list": {
          ctx.metadata({ title: "Listing investing research plans" })
          const plans = listInvestingResearchPlans({
            status: args.status,
            limit: args.limit,
          })
          return {
            title: "Investing Research Planner",
            metadata: { action: args.action, count: plans.length, status: args.status },
            output: JSON.stringify({ plans, count: plans.length }, null, 2),
          }
        }
        case "update": {
          ctx.metadata({ title: `Updating research task ${args.taskId}` })
          const plan = updateInvestingResearchTask({
            planId: args.planId,
            taskId: args.taskId,
            status: args.status,
            note: args.note,
          })
          return {
            title: "Investing Research Planner",
            metadata: { action: args.action, planId: plan.id, status: plan.status, taskId: args.taskId },
            output: JSON.stringify(plan, null, 2),
          }
        }
      }
    },
  }),
}

const ResearchExecutorParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("run"),
    planId: z.string().describe("Persisted research plan identifier"),
    taskId: z.string().optional().describe("Optional task override; defaults to the active task"),
  }),
  z.object({
    action: z.literal("read"),
    executionId: z.string().describe("Persisted execution identifier"),
  }),
  z.object({
    action: z.literal("list"),
    planId: z.string().optional().describe("Optional plan filter"),
    taskId: z.string().optional().describe("Optional task filter"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of executions to return"),
  }),
])

export const researchExecutorTool: ToolDefinition = {
  id: "zee:invest-executor",
  category: "domain",
  init: async () => ({
    description: `Execute investing research workflow steps across multiple sources, persist evidence-linked synthesis packets, and advance the underlying planner state.`,
    parameters: ResearchExecutorParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "run": {
          ctx.metadata({ title: `Running research execution for ${args.planId}` })
          const execution = await runInvestingResearchExecution({
            planId: args.planId,
            taskId: args.taskId,
          })
          return {
            title: "Investing Research Executor",
            metadata: {
              action: args.action,
              executionId: execution.id,
              planId: execution.planId,
              status: execution.status,
            },
            output: JSON.stringify(execution, null, 2),
          }
        }
        case "read": {
          ctx.metadata({ title: `Loading research execution ${args.executionId}` })
          const execution = getInvestingResearchExecution(args.executionId)
          return {
            title: "Investing Research Executor",
            metadata: { action: args.action, executionId: args.executionId, found: Boolean(execution) },
            output: JSON.stringify(
              execution ?? { error: `Research execution not found: ${args.executionId}` },
              null,
              2,
            ),
          }
        }
        case "list": {
          ctx.metadata({ title: "Listing research executions" })
          const executions = listInvestingResearchExecutions({
            planId: args.planId,
            taskId: args.taskId,
            limit: args.limit,
          })
          return {
            title: "Investing Research Executor",
            metadata: { action: args.action, count: executions.length, planId: args.planId, taskId: args.taskId },
            output: JSON.stringify({ executions, count: executions.length }, null, 2),
          }
        }
      }
    },
  }),
}

const ResearchArtifactsParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    executionId: z.string().describe("Persisted execution identifier"),
    overwrite: z.boolean().optional().default(false).describe("Regenerate the artifact even if one already exists"),
  }),
  z.object({
    action: z.literal("read"),
    artifactId: z.string().describe("Persisted artifact identifier"),
  }),
  z.object({
    action: z.literal("list"),
    planId: z.string().optional().describe("Optional plan filter"),
    taskId: z.string().optional().describe("Optional task filter"),
    executionId: z.string().optional().describe("Optional execution filter"),
    status: z.enum(INVESTING_RESEARCH_ARTIFACT_STATUSES).optional().describe("Optional artifact status filter"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of artifacts to return"),
  }),
])

export const researchArtifactsTool: ToolDefinition = {
  id: "zee:invest-artifacts",
  category: "domain",
  init: async () => ({
    description: `Create, read, and list structured investing research artifacts with failure diagnostics for operator review and future evals.`,
    parameters: ResearchArtifactsParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "create": {
          ctx.metadata({ title: `Creating research artifact for ${args.executionId}` })
          const execution = getInvestingResearchExecution(args.executionId)
          if (!execution) {
            return {
              title: "Investing Research Artifacts",
              metadata: { action: args.action, executionId: args.executionId, found: false },
              output: JSON.stringify({ error: `Research execution not found: ${args.executionId}` }, null, 2),
            }
          }

          const plan = getInvestingResearchPlan(execution.planId)
          const task = plan?.tasks.find((entry) => entry.id === execution.taskId)
          if (!plan || !task) {
            return {
              title: "Investing Research Artifacts",
              metadata: { action: args.action, executionId: args.executionId, found: false },
              output: JSON.stringify(
                { error: `Research plan context not found for execution: ${args.executionId}` },
                null,
                2,
              ),
            }
          }

          const artifact = createInvestingResearchArtifact({
            execution,
            plan,
            task,
            overwrite: args.overwrite,
          })
          return {
            title: "Investing Research Artifacts",
            metadata: {
              action: args.action,
              artifactId: artifact.id,
              executionId: artifact.executionId,
              status: artifact.status,
            },
            output: JSON.stringify(artifact, null, 2),
          }
        }
        case "read": {
          ctx.metadata({ title: `Loading research artifact ${args.artifactId}` })
          const artifact = getInvestingResearchArtifact(args.artifactId)
          return {
            title: "Investing Research Artifacts",
            metadata: { action: args.action, artifactId: args.artifactId, found: Boolean(artifact) },
            output: JSON.stringify(artifact ?? { error: `Research artifact not found: ${args.artifactId}` }, null, 2),
          }
        }
        case "list": {
          ctx.metadata({ title: "Listing research artifacts" })
          const artifacts = listInvestingResearchArtifacts({
            planId: args.planId,
            taskId: args.taskId,
            executionId: args.executionId,
            status: args.status,
            limit: args.limit,
          })
          return {
            title: "Investing Research Artifacts",
            metadata: {
              action: args.action,
              count: artifacts.length,
              planId: args.planId,
              taskId: args.taskId,
              executionId: args.executionId,
              status: args.status,
            },
            output: JSON.stringify({ artifacts, count: artifacts.length }, null, 2),
          }
        }
      }
    },
  }),
}

const EventIntelligenceParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
  }),
  z.object({
    action: z.literal("list"),
    connector: z.enum(INVESTING_EVENT_CONNECTORS).optional().describe("Optional connector filter"),
    classification: z.enum(INVESTING_EVENT_CLASSIFICATIONS).optional().describe("Optional classification filter"),
    direction: z.enum(INVESTING_EVENT_DIRECTIONS).optional().describe("Optional direction filter"),
    materialityBand: z.enum(INVESTING_EVENT_MATERIALITY_BANDS).optional().describe("Optional materiality band filter"),
    symbol: z.string().optional().describe("Optional symbol filter"),
    holdingOnly: z.boolean().default(false).describe("Only include events linked to holdings"),
    watchlistOnly: z.boolean().default(false).describe("Only include events linked to watchlist symbols"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of events to return"),
  }),
  z.object({
    action: z.literal("read"),
    eventId: z.string().describe("Persisted classified event identifier"),
  }),
])

export const eventIntelligenceTool: ToolDefinition = {
  id: "zee:invest-events",
  category: "domain",
  init: async () => ({
    description: `Inspect classified earnings and news events produced by Zee's event-intelligence ingestion layer.`,
    parameters: EventIntelligenceParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "status": {
          ctx.metadata({ title: "Loading investing event intelligence status" })
          const status = await getInvestingEventCatalogStatus()
          return {
            title: "Investing Event Intelligence",
            metadata: { action: args.action, totalEvents: status.totalEvents },
            output: JSON.stringify(status, null, 2),
          }
        }
        case "list": {
          ctx.metadata({ title: "Listing investing event intelligence records" })
          const events = await listInvestingEvents({
            connector: args.connector,
            classification: args.classification,
            direction: args.direction,
            materialityBand: args.materialityBand,
            symbol: args.symbol,
            holdingOnly: args.holdingOnly,
            watchlistOnly: args.watchlistOnly,
            limit: args.limit,
          })
          return {
            title: "Investing Event Intelligence",
            metadata: {
              action: args.action,
              count: events.length,
              connector: args.connector,
              classification: args.classification,
              direction: args.direction,
              materialityBand: args.materialityBand,
              symbol: args.symbol,
              holdingOnly: args.holdingOnly,
              watchlistOnly: args.watchlistOnly,
            },
            output: JSON.stringify({ events, count: events.length }, null, 2),
          }
        }
        case "read": {
          ctx.metadata({ title: `Loading investing event ${args.eventId}` })
          const event = await getInvestingEvent(args.eventId)
          return {
            title: "Investing Event Intelligence",
            metadata: { action: args.action, eventId: args.eventId, found: Boolean(event) },
            output: JSON.stringify(event ?? { error: `Event not found: ${args.eventId}` }, null, 2),
          }
        }
      }
    },
  }),
}

const ValuationKernelParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("run"),
    symbol: z.string().describe("Ticker symbol to value"),
    peers: z.array(z.string()).optional().describe("Optional peer set override"),
    discountRate: z.number().optional().describe("Optional DCF discount rate override"),
    terminalGrowth: z.number().optional().describe("Optional terminal growth rate override"),
    projectionYears: z.number().int().positive().optional().describe("Optional DCF projection horizon"),
    bearMultiplier: z.number().positive().optional().describe("Optional bear-case multiplier for scenario valuation"),
    bullMultiplier: z.number().positive().optional().describe("Optional bull-case multiplier for scenario valuation"),
  }),
  z.object({
    action: z.literal("read"),
    runId: z.string().describe("Persisted valuation kernel run identifier"),
  }),
  z.object({
    action: z.literal("list"),
    symbol: z.string().optional().describe("Optional symbol filter"),
    status: z.enum(["ok", "error"]).optional().describe("Optional valuation run status filter"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of valuation runs to return"),
  }),
])

export const valuationKernelTool: ToolDefinition = {
  id: "zee:invest-valuation",
  category: "domain",
  init: async () => ({
    description: `Run a reproducible valuation kernel across DCF, comparables, and bull/base/bear scenarios for a covered symbol.`,
    parameters: ValuationKernelParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "run": {
          ctx.metadata({ title: `Running valuation kernel for ${args.symbol}` })
          const run = await runInvestingValuationKernel(args)
          return {
            title: "Investing Valuation Kernel",
            metadata: { action: args.action, runId: run.id, symbol: run.symbol, status: run.status },
            output: JSON.stringify(run, null, 2),
          }
        }
        case "read": {
          ctx.metadata({ title: `Loading valuation kernel run ${args.runId}` })
          const run = getInvestingValuationKernel(args.runId)
          return {
            title: "Investing Valuation Kernel",
            metadata: { action: args.action, runId: args.runId, found: Boolean(run) },
            output: JSON.stringify(run ?? { error: `Valuation run not found: ${args.runId}` }, null, 2),
          }
        }
        case "list": {
          ctx.metadata({ title: "Listing valuation kernel runs" })
          const runs = listInvestingValuationKernels({
            symbol: args.symbol,
            status: args.status,
            limit: args.limit,
          })
          return {
            title: "Investing Valuation Kernel",
            metadata: { action: args.action, count: runs.length, symbol: args.symbol, status: args.status },
            output: JSON.stringify({ runs, count: runs.length }, null, 2),
          }
        }
      }
    },
  }),
}

const ValuationPacketParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    runId: z.string().describe("Persisted valuation kernel run identifier"),
    overwrite: z.boolean().optional().default(false).describe("Regenerate the packet even if one already exists"),
  }),
  z.object({
    action: z.literal("read"),
    packetId: z.string().describe("Persisted valuation packet identifier"),
  }),
  z.object({
    action: z.literal("list"),
    symbol: z.string().optional().describe("Optional symbol filter"),
    runId: z.string().optional().describe("Optional valuation run filter"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of packets to return"),
  }),
  z.object({
    action: z.literal("export"),
    packetId: z.string().describe("Persisted valuation packet identifier"),
    format: z.enum(["json", "markdown"]).default("json").describe("Export format"),
  }),
])

export const valuationPacketTool: ToolDefinition = {
  id: "zee:invest-valuation-packets",
  category: "domain",
  init: async () => ({
    description: `Create, inspect, list, and export standardized valuation packets for downstream portfolio operations.`,
    parameters: ValuationPacketParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "create": {
          ctx.metadata({ title: `Creating valuation packet for ${args.runId}` })
          const run = getInvestingValuationKernel(args.runId)
          if (!run) {
            return {
              title: "Investing Valuation Packets",
              metadata: { action: args.action, runId: args.runId, found: false },
              output: JSON.stringify({ error: `Valuation run not found: ${args.runId}` }, null, 2),
            }
          }

          const packet = createInvestingValuationPacket({
            run,
            overwrite: args.overwrite,
          })
          return {
            title: "Investing Valuation Packets",
            metadata: { action: args.action, packetId: packet.id, runId: packet.runId },
            output: JSON.stringify(packet, null, 2),
          }
        }
        case "read": {
          ctx.metadata({ title: `Loading valuation packet ${args.packetId}` })
          const packet = getInvestingValuationPacket(args.packetId)
          return {
            title: "Investing Valuation Packets",
            metadata: { action: args.action, packetId: args.packetId, found: Boolean(packet) },
            output: JSON.stringify(packet ?? { error: `Valuation packet not found: ${args.packetId}` }, null, 2),
          }
        }
        case "list": {
          ctx.metadata({ title: "Listing valuation packets" })
          const packets = listInvestingValuationPackets({
            symbol: args.symbol,
            runId: args.runId,
            limit: args.limit,
          })
          return {
            title: "Investing Valuation Packets",
            metadata: { action: args.action, count: packets.length, symbol: args.symbol, runId: args.runId },
            output: JSON.stringify({ packets, count: packets.length }, null, 2),
          }
        }
        case "export": {
          ctx.metadata({ title: `Exporting valuation packet ${args.packetId}` })
          const exported = exportInvestingValuationPacket({
            packetId: args.packetId,
            format: args.format,
          })
          return {
            title: "Investing Valuation Packets",
            metadata: {
              action: args.action,
              packetId: args.packetId,
              format: args.format,
              exportCount: exported.packet.audit.exportCount,
            },
            output: exported.content,
          }
        }
      }
    },
  }),
}

const EarningsPacketParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    executionId: z.string().describe("Persisted research execution identifier"),
    overwrite: z.boolean().optional().default(false).describe("Regenerate the packet even if one already exists"),
  }),
  z.object({
    action: z.literal("read"),
    packetId: z.string().describe("Persisted earnings packet identifier"),
  }),
  z.object({
    action: z.literal("list"),
    symbol: z.string().optional().describe("Optional symbol filter"),
    workflow: z.enum(INVESTING_EARNINGS_PACKET_WORKFLOWS).optional().describe("Optional workflow filter"),
    executionId: z.string().optional().describe("Optional execution filter"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of packets to return"),
  }),
  z.object({
    action: z.literal("export"),
    packetId: z.string().describe("Persisted earnings packet identifier"),
    format: z.enum(["json", "markdown"]).default("json").describe("Export format"),
  }),
])

export const earningsPacketTool: ToolDefinition = {
  id: "zee:invest-earnings-packets",
  category: "domain",
  init: async () => ({
    description: `Create, inspect, list, and export pre and post earnings packets tied to catalysts, risks, and valuation changes.`,
    parameters: EarningsPacketParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "create": {
          ctx.metadata({ title: `Creating earnings packet for ${args.executionId}` })
          const execution = getInvestingResearchExecution(args.executionId)
          if (!execution) {
            return {
              title: "Investing Earnings Packets",
              metadata: { action: args.action, executionId: args.executionId, found: false },
              output: JSON.stringify({ error: `Research execution not found: ${args.executionId}` }, null, 2),
            }
          }

          const plan = getInvestingResearchPlan(execution.planId)
          const task = plan?.tasks.find((entry) => entry.id === execution.taskId)
          if (!plan || !task) {
            return {
              title: "Investing Earnings Packets",
              metadata: { action: args.action, executionId: args.executionId, found: false },
              output: JSON.stringify(
                { error: `Research plan context not found for execution: ${args.executionId}` },
                null,
                2,
              ),
            }
          }

          const packet = await createInvestingEarningsPacket({
            execution,
            plan,
            task,
            overwrite: args.overwrite,
          })
          return {
            title: "Investing Earnings Packets",
            metadata: {
              action: args.action,
              packetId: packet.id,
              executionId: packet.executionId,
              workflow: packet.workflow,
              status: packet.status,
            },
            output: JSON.stringify(packet, null, 2),
          }
        }
        case "read": {
          ctx.metadata({ title: `Loading earnings packet ${args.packetId}` })
          const packet = getInvestingEarningsPacket(args.packetId)
          return {
            title: "Investing Earnings Packets",
            metadata: { action: args.action, packetId: args.packetId, found: Boolean(packet) },
            output: JSON.stringify(packet ?? { error: `Earnings packet not found: ${args.packetId}` }, null, 2),
          }
        }
        case "list": {
          ctx.metadata({ title: "Listing earnings packets" })
          const packets = listInvestingEarningsPackets({
            symbol: args.symbol,
            workflow: args.workflow,
            executionId: args.executionId,
            limit: args.limit,
          })
          return {
            title: "Investing Earnings Packets",
            metadata: {
              action: args.action,
              count: packets.length,
              symbol: args.symbol,
              workflow: args.workflow,
              executionId: args.executionId,
            },
            output: JSON.stringify({ packets, count: packets.length }, null, 2),
          }
        }
        case "export": {
          ctx.metadata({ title: `Exporting earnings packet ${args.packetId}` })
          const exported = exportInvestingEarningsPacket({
            packetId: args.packetId,
            format: args.format,
          })
          return {
            title: "Investing Earnings Packets",
            metadata: {
              action: args.action,
              packetId: args.packetId,
              format: args.format,
              exportCount: exported.packet.audit.exportCount,
            },
            output: exported.content,
          }
        }
      }
    },
  }),
}

const EvalCaseParams = z.object({
  label: z.string().describe("Operator-facing case label"),
  sourceKind: z.enum(INVESTING_EVAL_SOURCE_KINDS).describe("Persisted source type to capture as a golden snapshot"),
  sourceId: z.string().describe("Persisted source identifier"),
  expectations: z
    .object({
      requiredSectionTitles: z.array(z.string()).optional().describe("Override the required section-title list"),
      minCitationCount: z.number().min(0).optional().describe("Minimum citation count expected at run time"),
      maxDiagnosticCount: z.number().min(0).optional().describe("Maximum diagnostic count allowed at run time"),
      freshnessWithinHours: z.number().min(0).optional().describe("Optional freshness window for the live source"),
    })
    .optional(),
})

const EvalParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-dataset"),
    name: z.string().describe("Dataset name"),
    description: z.string().describe("Dataset description"),
    owner: z.string().describe("Owning team or operator"),
    cases: z.array(EvalCaseParams).min(1).describe("Cases to capture into the golden-set dataset"),
  }),
  z.object({
    action: z.literal("read-dataset"),
    datasetId: z.string().describe("Persisted eval dataset identifier"),
  }),
  z.object({
    action: z.literal("list-datasets"),
    owner: z.string().optional().describe("Optional owner filter"),
    limit: z.number().min(1).max(100).default(20).describe("Maximum number of datasets to return"),
  }),
  z.object({
    action: z.literal("run-dataset"),
    datasetId: z.string().describe("Persisted eval dataset identifier"),
  }),
  z.object({
    action: z.literal("read-run"),
    runId: z.string().describe("Persisted eval run identifier"),
  }),
  z.object({
    action: z.literal("list-runs"),
    datasetId: z.string().optional().describe("Optional dataset filter"),
    status: z.enum(INVESTING_EVAL_RUN_STATUSES).optional().describe("Optional run-status filter"),
    limit: z.number().min(1).max(100).default(20).describe("Maximum number of eval runs to return"),
  }),
])

export const evalsTool: ToolDefinition = {
  id: "zee:invest-evals",
  category: "domain",
  init: async () => ({
    description: `Create investing evaluation datasets from golden snapshots, inspect them, and run the repeatable harness against current research outputs.`,
    parameters: EvalParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "create-dataset": {
          ctx.metadata({ title: `Creating eval dataset ${args.name}` })
          const dataset = createInvestingEvalDataset({
            name: args.name,
            description: args.description,
            owner: args.owner,
            cases: args.cases,
          })
          return {
            title: "Investing Evals",
            metadata: {
              action: args.action,
              datasetId: dataset.id,
              owner: dataset.owner,
              caseCount: dataset.cases.length,
            },
            output: JSON.stringify(dataset, null, 2),
          }
        }
        case "read-dataset": {
          ctx.metadata({ title: `Loading eval dataset ${args.datasetId}` })
          const dataset = getInvestingEvalDataset(args.datasetId)
          return {
            title: "Investing Evals",
            metadata: { action: args.action, datasetId: args.datasetId, found: Boolean(dataset) },
            output: JSON.stringify(dataset ?? { error: `Eval dataset not found: ${args.datasetId}` }, null, 2),
          }
        }
        case "list-datasets": {
          ctx.metadata({ title: "Listing eval datasets" })
          const datasets = listInvestingEvalDatasets({
            owner: args.owner,
            limit: args.limit,
          })
          return {
            title: "Investing Evals",
            metadata: {
              action: args.action,
              owner: args.owner,
              count: datasets.length,
            },
            output: JSON.stringify({ datasets, count: datasets.length }, null, 2),
          }
        }
        case "run-dataset": {
          ctx.metadata({ title: `Running eval dataset ${args.datasetId}` })
          try {
            const run = runInvestingEvalDataset({ datasetId: args.datasetId })
            return {
              title: "Investing Evals",
              metadata: {
                action: args.action,
                datasetId: args.datasetId,
                runId: run.id,
                owner: run.owner,
                status: run.status,
                structural: run.scores.structural,
                factuality: run.scores.factuality,
                consistency: run.scores.consistency,
                timeliness: run.scores.timeliness,
                thresholdBreaches: run.thresholdBreaches,
                regressionCount: run.regression?.regressionCount ?? 0,
                alertCount: run.alerts.length,
                gateOk: run.gate.ok,
                routingKey: run.gate.routingKey,
              },
              output: JSON.stringify(run, null, 2),
            }
          } catch (error) {
            return {
              title: "Investing Evals",
              metadata: { action: args.action, datasetId: args.datasetId, found: false },
              output: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
            }
          }
        }
        case "read-run": {
          ctx.metadata({ title: `Loading eval run ${args.runId}` })
          const run = getInvestingEvalRun(args.runId)
          return {
            title: "Investing Evals",
            metadata: { action: args.action, runId: args.runId, found: Boolean(run) },
            output: JSON.stringify(run ?? { error: `Eval run not found: ${args.runId}` }, null, 2),
          }
        }
        case "list-runs": {
          ctx.metadata({ title: "Listing eval runs" })
          const runs = listInvestingEvalRuns({
            datasetId: args.datasetId,
            status: args.status,
            limit: args.limit,
          })
          return {
            title: "Investing Evals",
            metadata: {
              action: args.action,
              datasetId: args.datasetId,
              status: args.status,
              count: runs.length,
            },
            output: JSON.stringify({ runs, count: runs.length }, null, 2),
          }
        }
      }
    },
  }),
}

const ThesisQueryParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    thesis: z.string().describe("Thesis key or symbol"),
  }),
  z.object({
    action: z.literal("list"),
    symbol: z.string().optional().describe("Optional symbol filter"),
    status: z.enum(INVESTING_THESIS_RECORD_STATUSES).optional().describe("Optional thesis status filter"),
    conviction: z.enum(INVESTING_THESIS_CONVICTIONS).optional().describe("Optional conviction filter"),
    posture: z.enum(INVESTING_THESIS_POSTURES).optional().describe("Optional posture filter"),
    limit: z.number().min(1).max(100).default(20).describe("Maximum number of theses to return"),
  }),
  z.object({
    action: z.literal("history"),
    thesis: z.string().describe("Thesis key or symbol"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of revisions to return"),
  }),
  z.object({
    action: z.literal("diff"),
    thesis: z.string().describe("Thesis key or symbol"),
    fromVersion: z.number().int().min(0).optional().describe("Prior thesis version, defaults to the previous revision"),
    toVersion: z.number().int().min(1).optional().describe("Target thesis version, defaults to the latest revision"),
  }),
  z.object({
    action: z.literal("portfolio-rollup"),
    audience: z
      .enum(INVESTING_THESIS_PORTFOLIO_ROLLUP_AUDIENCES)
      .optional()
      .default("all")
      .describe("Roll up all portfolio names, only holdings, or only watchlist entries"),
    conviction: z.enum(INVESTING_THESIS_CONVICTIONS).optional().describe("Optional conviction filter"),
    posture: z.enum(INVESTING_THESIS_POSTURES).optional().describe("Optional posture filter"),
    limit: z.number().min(1).max(200).default(50).describe("Maximum number of rollup entries to return"),
  }),
])

export const thesisTool: ToolDefinition = {
  id: "zee:invest-thesis",
  category: "domain",
  init: async () => ({
    description: `Query persisted thesis records, inspect revision history and diffs, and build portfolio-level thesis rollup views.`,
    parameters: ThesisQueryParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "read": {
          ctx.metadata({ title: `Loading thesis ${args.thesis}` })
          const thesis = queryInvestingThesisRecord(args.thesis)
          return {
            title: "Investing Thesis Ledger",
            metadata: { action: args.action, thesis: args.thesis, found: Boolean(thesis) },
            output: JSON.stringify(thesis ?? { error: `Thesis not found: ${args.thesis}` }, null, 2),
          }
        }
        case "list": {
          ctx.metadata({ title: "Listing thesis records" })
          const theses = queryInvestingTheses({
            symbol: args.symbol,
            status: args.status,
            conviction: args.conviction,
            posture: args.posture,
            limit: args.limit,
          })
          return {
            title: "Investing Thesis Ledger",
            metadata: {
              action: args.action,
              count: theses.length,
              symbol: args.symbol,
              status: args.status,
              conviction: args.conviction,
              posture: args.posture,
            },
            output: JSON.stringify({ theses, count: theses.length }, null, 2),
          }
        }
        case "history": {
          ctx.metadata({ title: `Loading thesis history ${args.thesis}` })
          const history = getInvestingThesisHistory({
            thesis: args.thesis,
            limit: args.limit,
          })
          return {
            title: "Investing Thesis Ledger",
            metadata: {
              action: args.action,
              thesis: args.thesis,
              found: Boolean(history),
              revisionCount: history?.revisionCount,
            },
            output: JSON.stringify(history ?? { error: `Thesis not found: ${args.thesis}` }, null, 2),
          }
        }
        case "diff": {
          ctx.metadata({ title: `Diffing thesis ${args.thesis}` })
          try {
            const diff = diffInvestingThesisHistory({
              thesis: args.thesis,
              fromVersion: args.fromVersion,
              toVersion: args.toVersion,
            })
            return {
              title: "Investing Thesis Ledger",
              metadata: {
                action: args.action,
                thesis: args.thesis,
                found: Boolean(diff),
                fromVersion: args.fromVersion,
                toVersion: args.toVersion,
              },
              output: JSON.stringify(diff ?? { error: `Thesis not found: ${args.thesis}` }, null, 2),
            }
          } catch (error) {
            return {
              title: "Investing Thesis Ledger",
              metadata: {
                action: args.action,
                thesis: args.thesis,
                found: true,
                fromVersion: args.fromVersion,
                toVersion: args.toVersion,
              },
              output: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2),
            }
          }
        }
        case "portfolio-rollup": {
          ctx.metadata({ title: "Building thesis portfolio rollup" })
          const rollup = buildInvestingThesisPortfolioRollup({
            audience: args.audience,
            conviction: args.conviction,
            posture: args.posture,
            limit: args.limit,
          })
          return {
            title: "Investing Thesis Ledger",
            metadata: {
              action: args.action,
              audience: args.audience,
              count: rollup.entries.length,
              thesisTrackedCount: rollup.coverage.thesisTrackedCount,
            },
            output: JSON.stringify(rollup, null, 2),
          }
        }
      }
    },
  }),
}

const PortfolioBriefingParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    kind: z
      .enum(INVESTING_PORTFOLIO_BRIEFING_KINDS)
      .default("daily-portfolio-brief")
      .describe("Briefing workflow kind"),
    watchlistSymbols: z.array(z.string()).optional().describe("Optional explicit watchlist override"),
  }),
  z.object({
    action: z.literal("read"),
    briefingId: z.string().describe("Persisted portfolio briefing identifier"),
  }),
  z.object({
    action: z.literal("list"),
    kind: z.enum(INVESTING_PORTFOLIO_BRIEFING_KINDS).optional().describe("Optional briefing kind filter"),
    symbol: z.string().optional().describe("Optional symbol filter"),
    audience: z.enum(["holding", "watchlist"]).optional().describe("Optional audience filter"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of briefings to return"),
  }),
])

export const portfolioBriefingsTool: ToolDefinition = {
  id: "zee:invest-briefings",
  category: "domain",
  init: async () => ({
    description: `Create, read, and list daily portfolio briefings built from thesis state and event intelligence.`,
    parameters: PortfolioBriefingParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "create": {
          ctx.metadata({ title: `Creating ${args.kind}` })
          const briefing = await createInvestingPortfolioBriefing({
            watchlistSymbols: args.watchlistSymbols,
          })
          return {
            title: "Investing Portfolio Briefings",
            metadata: {
              action: args.action,
              briefingId: briefing.id,
              kind: briefing.kind,
              stateFile: getInvestingPortfolioBriefingStateFile(),
            },
            output: JSON.stringify(briefing, null, 2),
          }
        }
        case "read": {
          ctx.metadata({ title: `Loading portfolio briefing ${args.briefingId}` })
          const briefing = getInvestingPortfolioBriefing(args.briefingId)
          return {
            title: "Investing Portfolio Briefings",
            metadata: { action: args.action, briefingId: args.briefingId, found: Boolean(briefing) },
            output: JSON.stringify(briefing ?? { error: `Portfolio briefing not found: ${args.briefingId}` }, null, 2),
          }
        }
        case "list": {
          ctx.metadata({ title: "Listing portfolio briefings" })
          const briefings = listInvestingPortfolioBriefings({
            kind: args.kind,
            symbol: args.symbol,
            audience: args.audience,
            limit: args.limit,
          })
          return {
            title: "Investing Portfolio Briefings",
            metadata: {
              action: args.action,
              count: briefings.length,
              kind: args.kind,
              symbol: args.symbol,
              audience: args.audience,
            },
            output: JSON.stringify({ briefings, count: briefings.length }, null, 2),
          }
        }
      }
    },
  }),
}

const OpsAutomationParams = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-schedule"),
    workflow: z.enum(INVESTING_OPS_WORKFLOWS).describe("Ops workflow to automate"),
    scheduleMinutes: z.number().min(1).describe("Recurring cadence in minutes"),
    enabled: z.boolean().optional().default(true).describe("Whether the schedule is active"),
    symbol: z.string().optional().describe("Required for earnings packet workflows"),
    watchlistSymbols: z.array(z.string()).optional().describe("Optional watchlist override for daily briefs"),
    format: z.enum(INVESTING_OPS_FORMATS).optional().default("markdown").describe("Delivery format"),
    deliveryTarget: z
      .enum(INVESTING_OPS_DELIVERY_TARGETS)
      .optional()
      .default("audit-log")
      .describe("Delivery destination"),
  }),
  z.object({
    action: z.literal("update-schedule"),
    scheduleId: z.string().describe("Persisted ops schedule identifier"),
    enabled: z.boolean().optional().describe("Updated enabled state"),
    scheduleMinutes: z.number().min(1).optional().describe("Updated cadence in minutes"),
    symbol: z.string().optional().describe("Updated symbol for earnings workflows"),
    watchlistSymbols: z.array(z.string()).optional().describe("Updated watchlist override"),
    format: z.enum(INVESTING_OPS_FORMATS).optional().describe("Updated delivery format"),
    deliveryTarget: z.enum(INVESTING_OPS_DELIVERY_TARGETS).optional().describe("Updated delivery destination"),
  }),
  z.object({
    action: z.literal("read-schedule"),
    scheduleId: z.string().describe("Persisted ops schedule identifier"),
  }),
  z.object({
    action: z.literal("list-schedules"),
    workflow: z.enum(INVESTING_OPS_WORKFLOWS).optional().describe("Optional workflow filter"),
    enabled: z.boolean().optional().describe("Optional enabled filter"),
    symbol: z.string().optional().describe("Optional symbol filter"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of schedules to return"),
  }),
  z.object({
    action: z.literal("run-schedule"),
    scheduleId: z.string().describe("Persisted ops schedule identifier"),
  }),
  z.object({
    action: z.literal("read-delivery"),
    deliveryId: z.string().describe("Persisted ops delivery identifier"),
  }),
  z.object({
    action: z.literal("list-deliveries"),
    scheduleId: z.string().optional().describe("Optional schedule filter"),
    workflow: z.enum(INVESTING_OPS_WORKFLOWS).optional().describe("Optional workflow filter"),
    status: z.enum(["ok", "error"]).optional().describe("Optional run status filter"),
    symbol: z.string().optional().describe("Optional symbol filter"),
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of delivery records to return"),
  }),
])

export const opsAutomationTool: ToolDefinition = {
  id: "zee:invest-ops",
  category: "domain",
  init: async () => ({
    description: `Manage unattended investing research-op schedules and inspect their delivery audit trail.`,
    parameters: OpsAutomationParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      switch (args.action) {
        case "create-schedule": {
          ctx.metadata({ title: `Creating ops schedule for ${args.workflow}` })
          const schedule = createInvestingOpsSchedule({
            workflow: args.workflow,
            scheduleMinutes: args.scheduleMinutes,
            enabled: args.enabled,
            symbol: args.symbol,
            watchlistSymbols: args.watchlistSymbols,
            format: args.format,
            deliveryTarget: args.deliveryTarget,
          })
          return {
            title: "Investing Ops Automation",
            metadata: { action: args.action, scheduleId: schedule.id, workflow: schedule.workflow },
            output: JSON.stringify(schedule, null, 2),
          }
        }
        case "update-schedule": {
          ctx.metadata({ title: `Updating ops schedule ${args.scheduleId}` })
          const schedule = updateInvestingOpsSchedule({
            scheduleId: args.scheduleId,
            enabled: args.enabled,
            scheduleMinutes: args.scheduleMinutes,
            symbol: args.symbol,
            watchlistSymbols: args.watchlistSymbols,
            format: args.format,
            deliveryTarget: args.deliveryTarget,
          })
          return {
            title: "Investing Ops Automation",
            metadata: { action: args.action, scheduleId: schedule.id, workflow: schedule.workflow },
            output: JSON.stringify(schedule, null, 2),
          }
        }
        case "read-schedule": {
          ctx.metadata({ title: `Loading ops schedule ${args.scheduleId}` })
          const schedule = getInvestingOpsSchedule(args.scheduleId)
          return {
            title: "Investing Ops Automation",
            metadata: { action: args.action, scheduleId: args.scheduleId, found: Boolean(schedule) },
            output: JSON.stringify(schedule ?? { error: `Ops schedule not found: ${args.scheduleId}` }, null, 2),
          }
        }
        case "list-schedules": {
          ctx.metadata({ title: "Listing ops schedules" })
          const schedules = listInvestingOpsSchedules({
            workflow: args.workflow,
            enabled: args.enabled,
            symbol: args.symbol,
            limit: args.limit,
          })
          return {
            title: "Investing Ops Automation",
            metadata: {
              action: args.action,
              count: schedules.length,
              workflow: args.workflow,
              enabled: args.enabled,
              symbol: args.symbol,
            },
            output: JSON.stringify({ schedules, count: schedules.length }, null, 2),
          }
        }
        case "run-schedule": {
          ctx.metadata({ title: `Running ops schedule ${args.scheduleId}` })
          const delivery = await runInvestingOpsSchedule({
            scheduleId: args.scheduleId,
          })
          return {
            title: "Investing Ops Automation",
            metadata: {
              action: args.action,
              scheduleId: args.scheduleId,
              deliveryId: delivery.id,
              status: delivery.status,
            },
            output: JSON.stringify(delivery, null, 2),
          }
        }
        case "read-delivery": {
          ctx.metadata({ title: `Loading ops delivery ${args.deliveryId}` })
          const delivery = getInvestingOpsDeliveryRecord(args.deliveryId)
          return {
            title: "Investing Ops Automation",
            metadata: { action: args.action, deliveryId: args.deliveryId, found: Boolean(delivery) },
            output: JSON.stringify(delivery ?? { error: `Ops delivery not found: ${args.deliveryId}` }, null, 2),
          }
        }
        case "list-deliveries": {
          ctx.metadata({ title: "Listing ops deliveries" })
          const deliveries = listInvestingOpsDeliveryRecords({
            scheduleId: args.scheduleId,
            workflow: args.workflow,
            status: args.status,
            symbol: args.symbol,
            limit: args.limit,
          })
          return {
            title: "Investing Ops Automation",
            metadata: {
              action: args.action,
              count: deliveries.length,
              scheduleId: args.scheduleId,
              workflow: args.workflow,
              status: args.status,
              symbol: args.symbol,
            },
            output: JSON.stringify({ deliveries, count: deliveries.length }, null, 2),
          }
        }
      }
    },
  }),
}

// =============================================================================
// Nautilus Trading Tool
// =============================================================================

const NautilusParams = z.object({
  action: z.enum(["backtest", "paper_trade", "strategy_info", "market_status"]).describe("Trading action to perform"),
  strategy: z.string().optional().describe("Strategy name or ID"),
  symbols: z.array(z.string()).optional().describe("Symbols to trade"),
  startDate: z.string().optional().describe("Start date for backtest (YYYY-MM-DD)"),
  endDate: z.string().optional().describe("End date for backtest (YYYY-MM-DD)"),
})

export const nautilusTool: ToolDefinition = {
  id: "zee:invest-nautilus",
  category: "domain",
  init: async () => ({
    description: `Interface with NautilusTrader for algorithmic trading research. Actions: backtest, paper_trade, strategy_info, market_status. Simulation only, no real trading.`,
    parameters: NautilusParams,
    execute: withDeduplication("zee:invest-nautilus", async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, strategy, symbols, startDate, endDate } = args

      ctx.metadata({ title: `Nautilus: ${action}` })

      if (action === "market_status") {
        return {
          title: `NautilusTrader: ${action}`,
          metadata: { action, strategy, symbols },
          output: "Market status is not available in the Investing CLI yet.",
        }
      }

      if (!strategy) {
        return {
          title: `NautilusTrader: ${action}`,
          metadata: { action, symbols },
          output: "A strategy is required for this action.",
        }
      }

      const symbolArg = symbols?.length ? symbols.join(",") : ""
      const cliArgs =
        action === "paper_trade"
          ? ["nautilus", "paper-trade", strategy, "--capital", "100000"]
          : action === "strategy_info"
            ? ["nautilus", "strategy-info", strategy]
            : ["nautilus", "backtest", strategy, "--symbols", symbolArg, "--start", startDate || ""]
      const result = await runInvestingCli(cliArgs)
      const response = renderOutput(`NautilusTrader: ${action}`, result)
      response.metadata = { ...response.metadata, action, strategy, symbols, startDate, endDate }
      return response
    }),
  }),
}

export const statusTool: ToolDefinition = {
  id: "zee:invest-status",
  category: "domain",
  init: async () => ({
    description: "Check the health and connection status of the Investing investment platform.",
    parameters: z.object({}),
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const result = await runInvestingCli(["status"])
      // If 'status' isn't supported by CLI, we can try a lightweight command like checking version or help
      // Let's assume we just want to verify CLI is runnable.

      if (!result.ok && result.error?.includes("Investing CLI not found")) {
        return {
          title: "Investing Status",
          metadata: { ok: false },
          output: "Investing is not installed or not found. Configure the investing backend.",
        }
      }

      // Try a lightweight ping/version if status fails, but for now report result
      return renderOutput("Investing Status", result)
    },
  }),
}

// =============================================================================
// Analyst Estimates Tool
// =============================================================================

const EstimatesParams = z.object({
  symbol: z.string().describe("Stock ticker symbol (e.g., AAPL, MSFT)"),
  estimateType: z
    .enum(["consensus", "forward_eps", "price_target", "revisions"])
    .default("consensus")
    .describe(
      "Type of estimate: consensus (rating + targets), forward_eps (EPS projections), price_target (analyst targets), revisions (estimate changes)",
    ),
})

export const estimatesTool: ToolDefinition = {
  id: "zee:invest-estimates",
  category: "domain",
  init: async () => ({
    description: `Get analyst estimates, consensus ratings, forward EPS, price targets, and revision history. Use consensus for quick overview, forward_eps for quarterly/annual projections, price_target for individual analyst calls, revisions for upgrade/downgrade momentum.`,
    parameters: EstimatesParams,
    execute: withDeduplication("zee:invest-estimates", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, estimateType } = args
      ctx.metadata({ title: `Estimates: ${symbol} (${estimateType})` })
      const cliArgs = ["research", "estimates", symbol, "--type", estimateType]
      const result = await runInvestingCli(cliArgs)
      return renderOutput(`Estimates: ${symbol}`, result)
    }),
  }),
}

// =============================================================================
// Insider Trades Tool
// =============================================================================

const InsiderTradesParams = z.object({
  symbol: z.string().describe("Stock ticker symbol (e.g., AAPL, MSFT)"),
  limit: z.number().default(20).describe("Maximum number of transactions to return"),
})

export const insiderTradesTool: ToolDefinition = {
  id: "zee:invest-insider-trades",
  category: "domain",
  init: async () => ({
    description: `Get recent insider buy/sell transactions for a company. Returns officer names, transaction types, share amounts, prices, and a net sentiment summary (bullish/bearish). Useful for gauging management confidence.`,
    parameters: InsiderTradesParams,
    execute: withDeduplication("zee:invest-insider-trades", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, limit } = args
      ctx.metadata({ title: `Insider Trades: ${symbol}` })
      const cliArgs = ["research", "insider-trades", symbol, "--limit", String(limit)]
      const result = await runInvestingCli(cliArgs)
      return renderOutput(`Insider Trades: ${symbol}`, result)
    }),
  }),
}

// =============================================================================
// Business Segments Tool
// =============================================================================

const SegmentsParams = z.object({
  symbol: z.string().describe("Stock ticker symbol (e.g., AAPL, MSFT)"),
  segmentType: z
    .enum(["business", "geography"])
    .default("business")
    .describe("Breakdown type: business (product/service lines) or geography (regional revenue)"),
})

export const segmentsTool: ToolDefinition = {
  id: "zee:invest-segments",
  category: "domain",
  init: async () => ({
    description: `Get revenue breakdown by business segment or geography. Shows multi-period data with growth rates. Use business for product/service line analysis, geography for regional exposure. Essential for understanding revenue concentration and growth drivers.`,
    parameters: SegmentsParams,
    execute: withDeduplication("zee:invest-segments", async (args, ctx): Promise<ToolExecutionResult> => {
      const { symbol, segmentType } = args
      ctx.metadata({ title: `Segments: ${symbol} (${segmentType})` })
      const cliArgs = ["market", "segments", symbol, "--type", segmentType]
      const result = await runInvestingCli(cliArgs)
      return renderOutput(`Segments: ${symbol}`, result)
    }),
  }),
}

// =============================================================================
// Exports
// =============================================================================

export const INVESTING_TOOLS = [
  statusTool,
  marketDataTool,
  portfolioTool,
  secFilingsTool,
  researchTool,
  valuationKernelTool,
  valuationPacketTool,
  earningsPacketTool,
  evalsTool,
  thesisTool,
  portfolioBriefingsTool,
  opsAutomationTool,
  researchPlannerTool,
  researchExecutorTool,
  researchArtifactsTool,
  eventIntelligenceTool,
  nautilusTool,
  estimatesTool,
  insiderTradesTool,
  segmentsTool,
  scratchpadTool,
]

export function registerInvestingTools(registry: {
  register: (tool: ToolDefinition, options: { source: string }) => void
}): void {
  for (const tool of INVESTING_TOOLS) {
    registry.register(tool, { source: "domain" })
  }
}
