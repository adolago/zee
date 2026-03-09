/**
 * Investing Internal Plugin
 *
 * Registers all 18 SDK-backed investment analysis tools as native Zee tools.
 * Uses a lazily initialized investing client for HTTP transport.
 * Auto-persists research results to Zee's memory via tool.execute.after hook.
 */

import type { Hooks, PluginInput, ToolDefinition } from "@zee/plugin"
import { tool } from "@zee/plugin"
import {
  InvestingApiError,
  InvestingClient,
  InvestingDaemonError,
  InvestingNetworkError,
  InvestingNotRunningError,
  InvestingTimeoutError,
} from "@zee/investing-sdk"
import { Log } from "../util/log"
import { Investing } from "../paths"

const log = Log.create({ service: "plugin.investing" })

// ---------------------------------------------------------------------------
// Lazy client singleton
// ---------------------------------------------------------------------------

let client: InvestingClient | null = null
let clientKey: string | null = null
let connectPromise: Promise<void> | null = null
let preflightValidated = false

type InvestingPluginConfig = {
  enabled?: boolean
  baseUrl?: string
  apiKey?: string
  autoStart?: boolean
  wsEnabled?: boolean
  coreBin?: string
  repoPath?: string
}

type ResolvedInvestingPluginConfig = {
  baseUrl: string
  apiKey?: string
  autoStart: boolean
  wsEnabled: boolean
  coreBin?: string
  repoPath: string
}

let pluginConfig: InvestingPluginConfig = {}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::1"])
const B3_TICKER_PATTERN = /^[A-Z]{4}\d{1,2}$/
const SYMBOL_HINTS = ["not found", "no data", "unknown symbol", "invalid symbol", "ticker", "symbol not found"]

const ROUTER_KEYS = [
  "system",
  "market",
  "institutional",
  "analytics",
  "portfolio",
  "research",
  "commodities",
  "options",
  "etf",
  "macro",
  "accounting",
  "signals",
  "notes",
] as const

const wrappedTargets = new WeakSet<object>()

function resolveInvestingTimeoutMs(): number {
  const parsed = parseInt(process.env.ZEE_INVESTING_TIMEOUT_MS || "30000", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}

function isBrazilTickerCandidate(symbol: string): boolean {
  return !symbol.includes(".") && B3_TICKER_PATTERN.test(symbol)
}

function hasSymbolHint(message: string): boolean {
  const lower = message.toLowerCase()
  return SYMBOL_HINTS.some((hint) => lower.includes(hint))
}

function isSymbolLookupError(error: unknown): boolean {
  if (error instanceof InvestingApiError) {
    if (error.statusCode === 404 || error.statusCode === 422) return true
    return hasSymbolHint(`${error.message} ${error.responseBody ?? ""}`)
  }
  if (error instanceof Error) {
    return hasSymbolHint(error.message)
  }
  return false
}

function shouldRetryWithBrazilSuffix(result: ApiResult): boolean {
  if (result.success) return false
  return hasSymbolHint(result.error ?? "")
}

async function withBrazilSymbolFallback(symbol: string, request: (resolvedSymbol: string) => Promise<ApiResult>) {
  const normalized = normalizeSymbol(symbol)
  if (!isBrazilTickerCandidate(normalized)) {
    return request(normalized)
  }

  const retrySymbol = `${normalized}.SA`

  try {
    const primary = await request(normalized)
    if (!shouldRetryWithBrazilSuffix(primary)) return primary
  } catch (error) {
    if (!isSymbolLookupError(error)) throw error
  }

  return request(retrySymbol)
}

function resolveLocalDaemonEndpoint(baseUrl: string): { host: string; port: number } | null {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname
    if (!LOCAL_HOSTS.has(host)) return null
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80
    if (!Number.isFinite(port) || port <= 0 || port > 65_535) return null
    return { host, port }
  } catch {
    return null
  }
}

function formatInvestingError(error: unknown): string {
  if (error instanceof InvestingTimeoutError) {
    return `Investing request timed out after ${error.timeoutMs}ms.`
  }
  if (error instanceof InvestingNotRunningError) {
    return (
      `Investing API is not running at ${error.baseUrl}. ` +
      `Verify backend setup and set ZEE_INVESTING_CORE_BIN to the investing core executable when the default backend is unavailable.`
    )
  }
  if (error instanceof InvestingDaemonError) {
    return `Investing backend is unavailable. ${error.message}`
  }
  if (error instanceof InvestingNetworkError) {
    return `Unable to reach investing API. ${error.message}`
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function wrapRouterMethods(target: unknown): void {
  if (!target || typeof target !== "object") return
  if (wrappedTargets.has(target)) return
  wrappedTargets.add(target)

  const proto = Object.getPrototypeOf(target)
  if (!proto) return

  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === "constructor") continue
    const method = (target as Record<string, unknown>)[key]
    if (typeof method !== "function") continue
    ;(target as Record<string, unknown>)[key] = async (...args: unknown[]) => {
      await ensureConnected()
      return (method as (...args: unknown[]) => unknown).apply(target, args)
    }
  }
}

function wrapClientMethods(c: InvestingClient): void {
  for (const key of ROUTER_KEYS) {
    wrapRouterMethods((c as unknown as Record<string, unknown>)[key])
  }
  const rawRequest = c.rawRequest.bind(c)
  c.rawRequest = (async (...args: Parameters<InvestingClient["rawRequest"]>) => {
    await ensureConnected()
    return rawRequest(...args)
  }) as InvestingClient["rawRequest"]
}

function wrapToolErrors(tools: Record<string, ToolDefinition>): Record<string, ToolDefinition> {
  const wrapped: Record<string, ToolDefinition> = {}
  for (const [name, definition] of Object.entries(tools)) {
    wrapped[name] = {
      ...definition,
      async execute(args, context) {
        try {
          return await definition.execute(args as never, context)
        } catch (error) {
          log.warn("investing tool failed", {
            tool: name,
            error: error instanceof Error ? error.message : String(error),
          })
          return `Error: ${formatInvestingError(error)}`
        }
      },
    }
  }
  return wrapped
}

function getEffectiveConfig(override?: InvestingPluginConfig): ResolvedInvestingPluginConfig {
  const merged = { ...pluginConfig, ...override }
  const baseUrl = merged.baseUrl ?? Investing.apiUrl()
  const explicitApiUrl = Boolean(process.env.ZEE_INVESTING_API_URL?.trim())
  return {
    baseUrl,
    apiKey: merged.apiKey ?? process.env.ZEE_INVESTING_API_KEY,
    autoStart: merged.autoStart ?? (!explicitApiUrl && resolveLocalDaemonEndpoint(baseUrl) !== null),
    wsEnabled: merged.wsEnabled ?? false,
    coreBin: merged.coreBin ?? Investing.coreBin(),
    repoPath: merged.repoPath ?? process.env.ZEE_INVESTING_REPO_PATH ?? Investing.repo(),
  }
}

function buildClientKey(config: ResolvedInvestingPluginConfig): string {
  return JSON.stringify(config)
}

function getClient(override?: InvestingPluginConfig): InvestingClient {
  const effective = getEffectiveConfig(override)
  const key = buildClientKey(effective)

  if (client && clientKey === key) return client

  if (client && clientKey !== key) {
    void client.disconnect().catch(() => {})
    connectPromise = null
    preflightValidated = false
  }

  const daemonEndpoint = resolveLocalDaemonEndpoint(effective.baseUrl)
  clientKey = key
  client = new InvestingClient({
    baseUrl: effective.baseUrl,
    daemon: {
      autoStart: effective.autoStart,
      coreBin: effective.coreBin,
      repoPath: effective.repoPath,
      ...(daemonEndpoint ? { host: daemonEndpoint.host, port: daemonEndpoint.port } : {}),
    },
    http: {
      timeoutMs: resolveInvestingTimeoutMs(),
    },
    ws: {
      enabled: effective.wsEnabled,
    },
    auth: {
      apiKey: effective.apiKey,
    },
  })
  wrapClientMethods(client)
  return client
}

function ensurePreflight(): void {
  if (!getEffectiveConfig().autoStart) return
  if (preflightValidated) return
  const preflightError = Investing.preflight()
  if (preflightError) {
    throw new InvestingDaemonError(preflightError)
  }
  preflightValidated = true
}

async function ensureConnected(): Promise<void> {
  if (connectPromise) return connectPromise
  connectPromise = (async () => {
    ensurePreflight()
    await getClient().connect()
  })().catch((error) => {
    connectPromise = null
    throw error
  })
  return connectPromise
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ApiResult = { success: boolean; data: unknown; error: string | null }

function fmt(res: ApiResult): string {
  if (!res.success || res.error) return `Error: ${res.error || "Unknown error"}`
  if (!res.data) return "No data available"
  return JSON.stringify(res.data, null, 2)
}

// ---------------------------------------------------------------------------
// Persist rules — which tool results auto-save to memory
// ---------------------------------------------------------------------------

const PERSIST_PATTERNS = new Set([
  "zee_invest_research",
  "zee_invest_portfolio",
  "zee_invest_signals",
  "zee_invest_macro",
  "zee_invest_accounting",
  "zee_invest_deep_dive",
  "zee_invest_risk_check",
  "zee_invest_morning_brief",
  "zee_invest_trade_journal_entry",
  "zee_invest_notes",
])

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export async function InvestingPlugin(input: PluginInput): Promise<Hooks> {
  return {
    async config(config) {
      const cfg = (config as Record<string, unknown>).investing as InvestingPluginConfig | undefined
      if (cfg?.enabled === false) {
        log.info("investing plugin disabled via config")
        return
      }
      pluginConfig = { ...pluginConfig, ...cfg }
      // Pre-warm client with config values
      if (cfg) {
        getClient(cfg)
      }
    },

    // Auto-persist research results to Zee memory
    async "tool.execute.after"(inp, output) {
      if (!PERSIST_PATTERNS.has(inp.tool)) return
      try {
        const c = getClient()
        if (!c.memory.isConfigured) return
        const data =
          typeof output.output === "string"
            ? (() => {
                try {
                  return JSON.parse(output.output)
                } catch {
                  return { value: output.output }
                }
              })()
            : output.output
        const context: Record<string, string> = {}
        if (typeof data?.symbol === "string") context.symbol = data.symbol
        const toolAction = inp.tool.replace("zee_invest_", "")
        await c.memory.onToolResult(toolAction, data, context)
      } catch {
        // Best effort
      }
    },

    // Cleanup on lifecycle events
    async event({ event }) {
      if ((event as { type?: string }).type === "session.end" && client) {
        await client.disconnect().catch(() => {})
        client = null
        clientKey = null
        connectPromise = null
        preflightValidated = false
      }
    },

    // -----------------------------------------------------------------------
    // Tool registrations — all 18 tools
    // -----------------------------------------------------------------------
    tool: wrapToolErrors({
      // =====================================================================
      // Tier 1: Domain tools with discriminated action param
      // =====================================================================

      zee_invest_market: tool({
        description:
          "Get market data including quotes, historical prices, and market overview. Actions: quote, history, overview.",
        args: {
          action: tool.schema
            .enum(["quote", "history", "overview"])
            .describe("Action: quote for price, history for bars, overview for market-wide summary"),
          symbol: tool.schema.string().optional().describe("Stock ticker (required for quote/history)"),
          period: tool.schema.string().optional().describe("History period: 1D, 1W, 1M, 3M, 6M, 1Y"),
          interval: tool.schema.string().optional().describe("Bar interval: 1d, 1h, 5m"),
        },
        async execute(args) {
          const c = getClient()
          switch (args.action) {
            case "quote": {
              if (!args.symbol) return "Error: symbol is required for quote action"
              return fmt(await withBrazilSymbolFallback(args.symbol, (symbol) => c.market.getData(symbol)))
            }
            case "history": {
              if (!args.symbol) return "Error: symbol is required for history action"
              return fmt(
                await withBrazilSymbolFallback(args.symbol, (symbol) => c.market.getHistory(symbol, args.period, args.interval)),
              )
            }
            case "overview":
              return fmt(await c.market.getOverview())
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_research: tool({
        description:
          "Generate equity research: full reports, valuation analysis, earnings, peer comparison, DCF models.",
        args: {
          action: tool.schema
            .enum(["report", "valuation", "earnings", "peers", "dcf"])
            .describe("Action: report, valuation, earnings, peers, or dcf"),
          symbol: tool.schema.string().describe("Stock ticker symbol (e.g., AAPL)"),
          include_dcf: tool.schema.boolean().optional().describe("Include DCF in valuation"),
          quarters: tool.schema.number().optional().describe("Quarters for earnings analysis"),
          peers: tool.schema.string().optional().describe("Comma-separated peer symbols"),
          discount_rate: tool.schema.number().optional().describe("Override WACC for DCF"),
          terminal_growth: tool.schema.number().optional().describe("Terminal growth rate"),
          projection_years: tool.schema.number().optional().describe("DCF projection years"),
        },
        async execute(args) {
          const c = getClient()
          const sym = normalizeSymbol(args.symbol)
          switch (args.action) {
            case "report":
              return fmt(await withBrazilSymbolFallback(sym, (symbol) => c.research.getReport(symbol)))
            case "valuation":
              return fmt(await withBrazilSymbolFallback(sym, (symbol) => c.research.getValuation(symbol, args.include_dcf)))
            case "earnings":
              return fmt(await withBrazilSymbolFallback(sym, (symbol) => c.research.getEarnings(symbol, args.quarters)))
            case "peers":
              return fmt(await withBrazilSymbolFallback(sym, (symbol) => c.research.getPeers(symbol, args.peers)))
            case "dcf":
              return fmt(
                await withBrazilSymbolFallback(sym, (symbol) =>
                  c.research.getDCF(symbol, {
                    discountRate: args.discount_rate,
                    terminalGrowth: args.terminal_growth,
                    projectionYears: args.projection_years,
                  }),
                ),
              )
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_portfolio: tool({
        description:
          "Analyze portfolios for risk, performance, and composition. VaR, beta, sector exposure, attribution.",
        args: {
          action: tool.schema
            .enum(["analytics", "var", "beta", "sector_exposure", "performance"])
            .describe("Action: analytics, var, beta, sector_exposure, or performance"),
          holdings: tool.schema
            .array(
              tool.schema.object({
                symbol: tool.schema.string(),
                shares: tool.schema.number(),
                average_cost: tool.schema.number().optional(),
              }),
            )
            .describe("Portfolio holdings"),
          benchmark: tool.schema.string().optional().describe("Benchmark symbol (default: SPY)"),
          confidence_level: tool.schema.number().optional().describe("VaR confidence level"),
          method: tool.schema.enum(["historical", "parametric"]).optional().describe("VaR calculation method"),
          lookback_days: tool.schema.number().optional().describe("Lookback period in days"),
          period: tool.schema.enum(["1M", "3M", "6M", "1Y"]).optional().describe("Attribution period"),
        },
        async execute(args) {
          const c = getClient()
          const h = args.holdings.map((item: { symbol: string; shares: number; average_cost?: number }) => ({
            symbol: item.symbol,
            shares: item.shares,
            averageCost: item.average_cost,
          }))
          switch (args.action) {
            case "analytics":
              return fmt(await c.portfolio.getAnalytics(h, args.benchmark))
            case "var":
              return fmt(
                await c.portfolio.getRisk(h, {
                  confidenceLevel: args.confidence_level,
                  method: args.method,
                  lookbackDays: args.lookback_days,
                }),
              )
            case "beta":
            case "sector_exposure":
              return fmt(await c.portfolio.getSectorExposure(h, args.benchmark))
            case "performance":
              return fmt(await c.portfolio.getAttribution(h, args.period, args.benchmark))
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_institutional: tool({
        description:
          "Analyze institutional investor activity: 13F holdings, ownership breakdown, whale moves, sentiment.",
        args: {
          action: tool.schema
            .enum(["holdings", "ownership", "whales", "sentiment", "smart_money_flow"])
            .describe("Action: holdings, ownership, whales, sentiment, or smart_money_flow"),
          symbol: tool.schema.string().describe("Stock ticker symbol"),
          limit: tool.schema.number().optional().describe("Max results for holdings"),
        },
        async execute(args) {
          const c = getClient()
          const sym = args.symbol.toUpperCase()
          switch (args.action) {
            case "holdings":
              return fmt(await c.institutional.getHoldings(sym, args.limit))
            case "ownership":
              return fmt(await c.institutional.getOwnership(sym))
            case "whales":
              return fmt(await c.institutional.getWhales(sym))
            case "sentiment":
              return fmt(await c.institutional.getSentiment(sym))
            case "smart_money_flow":
              return fmt(await c.institutional.getSmartMoneyFlow(sym))
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_analytics: tool({
        description: "Analyze money flow patterns, dark pool activity, equity flows, and sector rotation.",
        args: {
          action: tool.schema
            .enum(["money_flow", "dark_pool", "equity_flow", "sector_rotation"])
            .describe("Action: money_flow, dark_pool, equity_flow, or sector_rotation"),
          symbol: tool.schema.string().optional().describe("Stock ticker (required for dark_pool, equity_flow)"),
          sectors: tool.schema.array(tool.schema.string()).optional().describe("Sector ETFs for money_flow"),
          lookback_days: tool.schema.number().optional().describe("Analysis period in days"),
        },
        async execute(args) {
          const c = getClient()
          switch (args.action) {
            case "money_flow": {
              if (!args.sectors?.length) return "Error: sectors required for money_flow action"
              return fmt(await c.analytics.getMoneyFlow(args.sectors, args.lookback_days))
            }
            case "dark_pool": {
              if (!args.symbol) return "Error: symbol required for dark_pool action"
              return fmt(await c.analytics.getDarkPool(args.symbol))
            }
            case "equity_flow": {
              if (!args.symbol) return "Error: symbol required for equity_flow action"
              return fmt(await c.analytics.getEquityFlow(args.symbol))
            }
            case "sector_rotation":
              return fmt(await c.analytics.getSectorRotation())
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_options: tool({
        description: "Analyze options market: flow, chains, unusual trades, put/call ratios, max pain.",
        args: {
          action: tool.schema
            .enum(["flow", "chain", "unusual", "put_call", "max_pain"])
            .describe("Action: flow, chain, unusual, put_call, or max_pain"),
          symbol: tool.schema.string().describe("Stock ticker symbol"),
          expiry: tool.schema.string().optional().describe("Options expiration date"),
        },
        async execute(args) {
          const c = getClient()
          const sym = args.symbol.toUpperCase()
          switch (args.action) {
            case "flow":
              return fmt(await c.options.getFlow(sym))
            case "chain":
              return fmt(await c.options.getChain(sym, args.expiry))
            case "unusual":
              return fmt(await c.options.getUnusualActivity(sym))
            case "put_call":
              return fmt(await c.options.getPutCallRatio(sym))
            case "max_pain":
              return fmt(await c.options.getMaxPain(sym, args.expiry))
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_etf: tool({
        description: "Analyze ETF flows, sector rotation signals, smart beta factors, and thematic trends.",
        args: {
          action: tool.schema
            .enum(["flows", "sector_rotation", "smart_beta", "thematic"])
            .describe("Action: flows, sector_rotation, smart_beta, or thematic"),
        },
        async execute(args) {
          const c = getClient()
          switch (args.action) {
            case "flows":
              return fmt(await c.etf.getFlows())
            case "sector_rotation":
              return fmt(await c.etf.getSectorRotation())
            case "smart_beta":
              return fmt(await c.etf.getSmartBeta())
            case "thematic":
              return fmt(await c.etf.getThematic())
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_macro: tool({
        description: "Analyze macroeconomic conditions: indicators, regime detection, yield curves, calendar.",
        args: {
          action: tool.schema
            .enum(["indicators", "regime", "yield_curve", "calendar"])
            .describe("Action: indicators, regime, yield_curve, or calendar"),
          country: tool.schema.string().optional().describe("Country code (default: US)"),
          category: tool.schema.string().optional().describe("Indicator category filter"),
        },
        async execute(args) {
          const c = getClient()
          switch (args.action) {
            case "indicators":
              return fmt(await c.macro.getIndicators(args.country, args.category))
            case "regime":
              return fmt(await c.macro.getRegime())
            case "yield_curve":
              return fmt(await c.macro.getYieldCurve(args.country))
            case "calendar":
              return fmt(await c.macro.getCalendar())
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_commodities: tool({
        description: "Analyze commodity markets: prices, trends, correlations, macro-economic linkages.",
        args: {
          action: tool.schema
            .enum(["overview", "detail", "correlations", "macro_linkages"])
            .describe("Action: overview, detail, correlations, or macro_linkages"),
          symbol: tool.schema.string().optional().describe("Commodity symbol (required for detail, macro_linkages)"),
        },
        async execute(args) {
          const c = getClient()
          switch (args.action) {
            case "overview":
              return fmt(await c.commodities.getOverview())
            case "detail": {
              if (!args.symbol) return "Error: symbol required for detail action"
              return fmt(await c.commodities.getDetail(args.symbol))
            }
            case "correlations":
              return fmt(await c.commodities.getCorrelations())
            case "macro_linkages": {
              if (!args.symbol) return "Error: symbol required for macro_linkages action"
              return fmt(await c.commodities.getMacroLinkages(args.symbol))
            }
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_accounting: tool({
        description:
          "Analyze accounting quality and SEC filings. Piotroski F-Score, Altman Z-Score, red flags, earnings quality.",
        args: {
          action: tool.schema
            .enum(["quality", "red_flags", "piotroski", "altman", "filings"])
            .describe("Action: quality, red_flags, piotroski, altman, or filings"),
          symbol: tool.schema.string().describe("Stock ticker symbol"),
        },
        async execute(args) {
          const c = getClient()
          const sym = args.symbol.toUpperCase()
          switch (args.action) {
            case "quality":
              return fmt(await c.accounting.getQuality(sym))
            case "red_flags":
              return fmt(await c.accounting.getRedFlags(sym))
            case "piotroski":
              return fmt(await c.accounting.getPiotroski(sym))
            case "altman":
              return fmt(await c.accounting.getAltman(sym))
            case "filings":
              return fmt(await c.accounting.getFilings(sym))
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_signals: tool({
        description: "Generate, backtest, and track investment signals based on multi-factor analysis.",
        args: {
          action: tool.schema
            .enum(["generate", "backtest", "performance", "alerts"])
            .describe("Action: generate, backtest, performance, or alerts"),
          symbols: tool.schema.array(tool.schema.string()).optional().describe("Symbols for generation/backtest"),
          min_conviction: tool.schema.number().optional().describe("Minimum conviction threshold"),
          start_date: tool.schema.string().optional().describe("Backtest start date"),
          end_date: tool.schema.string().optional().describe("Backtest end date"),
          holding_period_days: tool.schema.number().optional().describe("Holding period for backtest"),
          initial_capital: tool.schema.number().optional().describe("Initial capital for backtest"),
        },
        async execute(args) {
          const c = getClient()
          switch (args.action) {
            case "generate": {
              if (!args.symbols?.length) return "Error: symbols required for generate action"
              return fmt(await c.signals.generate(args.symbols, args.min_conviction))
            }
            case "backtest": {
              if (!args.symbols?.length) return "Error: symbols required for backtest action"
              return fmt(
                await c.signals.backtest({
                  symbols: args.symbols,
                  startDate: args.start_date,
                  endDate: args.end_date,
                  holdingPeriodDays: args.holding_period_days ?? 30,
                  initialCapital: args.initial_capital ?? 100_000,
                }),
              )
            }
            case "performance":
            case "alerts":
              return fmt(await c.signals.getPerformance())
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      zee_invest_notes: tool({
        description: "Manage research notes, investment theses, and trade journal entries.",
        args: {
          action: tool.schema
            .enum(["list", "create", "update", "search", "graph"])
            .describe("Action: list, create, update, search, or graph"),
          type: tool.schema.enum(["note", "thesis", "trade"]).optional().describe("Note type"),
          name: tool.schema.string().optional().describe("Note name (for update)"),
          content: tool.schema.string().optional().describe("Note content (for create/update)"),
          query: tool.schema.string().optional().describe("Search query"),
          symbol: tool.schema.string().optional().describe("Symbol for thesis/trade"),
          conviction: tool.schema.string().optional().describe("Conviction level for thesis"),
          direction: tool.schema.string().optional().describe("Trade direction (long/short)"),
          entry_price: tool.schema.number().optional().describe("Trade entry price"),
          shares: tool.schema.number().optional().describe("Number of shares"),
        },
        async execute(args) {
          const c = getClient()
          switch (args.action) {
            case "list": {
              if (args.type === "thesis") return fmt(await c.notes.getTheses())
              if (args.type === "trade") return fmt(await c.notes.getTrades())
              return fmt(await c.notes.listNotes())
            }
            case "create": {
              if (args.type === "thesis") {
                if (!args.symbol) return "Error: symbol required for thesis"
                return fmt(await c.notes.createThesis({ symbol: args.symbol, conviction: args.conviction ?? "medium" }))
              }
              if (args.type === "trade") {
                if (!args.symbol || !args.direction || !args.entry_price || !args.shares)
                  return "Error: symbol, direction, entry_price, shares required for trade"
                return fmt(
                  await c.notes.createTrade({
                    symbol: args.symbol,
                    direction: args.direction,
                    entryPrice: args.entry_price,
                    shares: args.shares,
                  }),
                )
              }
              if (!args.name || !args.content) return "Error: name and content required for note"
              return fmt(await c.notes.saveNote(args.name, args.content))
            }
            case "update": {
              if (!args.name || !args.content) return "Error: name and content required for update"
              return fmt(await c.notes.saveNote(args.name, args.content))
            }
            case "search": {
              if (!args.query) return "Error: query required for search"
              return fmt(await c.notes.searchNotes(args.query))
            }
            case "graph":
              return fmt(await c.notes.getGraph())
            default:
              return `Unknown action: ${args.action}`
          }
        },
      }),

      // =====================================================================
      // Tier 2: Composite tools
      // =====================================================================

      zee_invest_deep_dive: tool({
        description:
          "Comprehensive deep-dive on a company. Combines market data, research, institutional holdings, accounting, and options flow.",
        args: {
          symbol: tool.schema.string().describe("Stock ticker symbol"),
        },
        async execute(args) {
          const c = getClient()
          const sym = args.symbol.toUpperCase()

          const [marketRes, researchRes, institutionalRes, accountingRes, optionsRes] = await Promise.allSettled([
            c.market.getData(sym),
            c.research.getReport(sym),
            c.institutional.getOwnership(sym),
            c.accounting.getRedFlags(sym),
            c.options.getFlow(sym),
          ])

          const sections: string[] = [`Deep Dive: ${sym}\n`]

          if (marketRes.status === "fulfilled" && marketRes.value.success && marketRes.value.data) {
            const m = marketRes.value.data as unknown as Record<string, unknown>
            sections.push(
              `Market: Price $${m.price} (${m.changePercent}%) | Vol: ${m.volume} | MCap: ${m.marketCap ?? "N/A"}`,
            )
          }

          if (researchRes.status === "fulfilled" && researchRes.value.success && researchRes.value.data) {
            const r = researchRes.value.data as unknown as Record<string, unknown>
            sections.push(
              `Fundamentals: ${r.companyName} | Score: ${r.overallScore}/100 | Rating: ${r.valuationRating}`,
            )
          }

          if (
            institutionalRes.status === "fulfilled" &&
            institutionalRes.value.success &&
            institutionalRes.value.data
          ) {
            const i = institutionalRes.value.data as unknown as Record<string, unknown>
            sections.push(`Ownership: Institutional ${i.institutionalOwnership}% | Insider ${i.insiderOwnership}%`)
          }

          if (accountingRes.status === "fulfilled" && accountingRes.value.success && accountingRes.value.data) {
            const a = accountingRes.value.data as unknown as Record<string, unknown>
            sections.push(`Accounting: Risk ${a.overallRisk} | Flags: ${(a.flags as unknown[])?.length ?? 0}`)
          }

          if (optionsRes.status === "fulfilled" && optionsRes.value.success && optionsRes.value.data) {
            const o = optionsRes.value.data as unknown as Record<string, unknown>
            sections.push(`Options: P/C ${o.putCallRatio} | Net Premium: ${o.netPremium}`)
          }

          return sections.join("\n")
        },
      }),

      zee_invest_risk_check: tool({
        description: "Quick portfolio risk snapshot combining VaR, macro regime detection, and correlation analysis.",
        args: {
          holdings: tool.schema
            .array(
              tool.schema.object({
                symbol: tool.schema.string(),
                shares: tool.schema.number(),
                average_cost: tool.schema.number().optional(),
              }),
            )
            .describe("Portfolio holdings to analyze"),
        },
        async execute(args) {
          const c = getClient()
          const h = args.holdings.map((item: { symbol: string; shares: number; average_cost?: number }) => ({
            symbol: item.symbol,
            shares: item.shares,
            averageCost: item.average_cost,
          }))

          const [riskRes, regimeRes, corrRes] = await Promise.allSettled([
            c.portfolio.getRisk(h),
            c.macro.getRegime(),
            c.portfolio.getCorrelation(h),
          ])

          const sections: string[] = ["Portfolio Risk Check\n"]

          if (riskRes.status === "fulfilled" && riskRes.value.success && riskRes.value.data) {
            sections.push(JSON.stringify(riskRes.value.data, null, 2))
          }

          if (regimeRes.status === "fulfilled" && regimeRes.value.success && regimeRes.value.data) {
            const m = regimeRes.value.data as unknown as Record<string, unknown>
            sections.push(`Macro Regime: ${m.currentRegime} (${m.confidence} confidence)`)
          }

          if (corrRes.status === "fulfilled" && corrRes.value.success && corrRes.value.data) {
            const c = corrRes.value.data as unknown as Record<string, unknown>
            sections.push(`Diversification Score: ${c.diversificationScore}/100`)
          }

          return sections.join("\n\n")
        },
      }),

      zee_invest_morning_brief: tool({
        description: "Morning market briefing with macro regime, sector rotation, ETF flows, and watchlist signals.",
        args: {
          watchlist: tool.schema.array(tool.schema.string()).optional().describe("Optional watchlist symbols"),
        },
        async execute(args) {
          const c = getClient()

          const promises: Promise<unknown>[] = [c.macro.getRegime(), c.etf.getSectorRotation(), c.etf.getFlows()]
          if (args.watchlist?.length) {
            promises.push(c.signals.generate(args.watchlist, 0.5))
          }

          const results = await Promise.allSettled(promises)
          const sections: string[] = ["Morning Brief\n"]

          for (const r of results) {
            if (r.status === "fulfilled") {
              const res = r.value as ApiResult
              if (res.success && res.data) {
                sections.push(JSON.stringify(res.data, null, 2))
              }
            }
          }

          return sections.join("\n\n")
        },
      }),

      zee_invest_trade_journal_entry: tool({
        description: "Create a trade journal entry with automatic thesis linking and context capture.",
        args: {
          symbol: tool.schema.string().describe("Stock ticker symbol"),
          direction: tool.schema.enum(["long", "short"]).describe("Trade direction"),
          entry_price: tool.schema.number().describe("Entry price"),
          shares: tool.schema.number().describe("Number of shares"),
          thesis: tool.schema.string().optional().describe("Brief investment thesis"),
          conviction: tool.schema.string().optional().describe("Conviction level: low, medium, high"),
        },
        async execute(args) {
          const c = getClient()
          const sym = args.symbol.toUpperCase()

          const [tradeRes, researchRes] = await Promise.allSettled([
            c.notes.createTrade({
              symbol: sym,
              direction: args.direction,
              entryPrice: args.entry_price,
              shares: args.shares,
            }),
            c.research.getSummary(sym),
          ])

          const sections: string[] = [
            `Trade Entry: ${args.direction.toUpperCase()} ${sym}`,
            `Entry: $${args.entry_price} x ${args.shares} shares`,
            `Position Size: $${args.entry_price * args.shares}`,
            `Conviction: ${args.conviction ?? "medium"}`,
          ]

          if (args.thesis) sections.push(`Thesis: ${args.thesis}`)

          if (tradeRes.status === "fulfilled" && (tradeRes.value as ApiResult).success) {
            sections.push("Trade recorded successfully.")
          }

          if (researchRes.status === "fulfilled" && (researchRes.value as ApiResult).success) {
            const r = (researchRes.value as ApiResult).data as Record<string, unknown> | null
            if (r) {
              sections.push(`Context: Score ${r.overallScore}/100 | Rating: ${r.valuationRating}`)
            }
          }

          return sections.join("\n")
        },
      }),

      zee_invest_screen: tool({
        description:
          "Screen stocks using multi-factor analysis: research scores, institutional activity, accounting quality.",
        args: {
          symbols: tool.schema.array(tool.schema.string()).describe("Symbols to screen (max 20)"),
          min_score: tool.schema.number().optional().describe("Minimum research score (0-100)"),
          require_institutional_buying: tool.schema
            .boolean()
            .optional()
            .describe("Only show stocks with net institutional buying"),
          max_risk: tool.schema
            .enum(["low", "medium", "high", "any"])
            .optional()
            .describe("Maximum accounting risk level"),
        },
        async execute(args) {
          const c = getClient()
          const minScore = args.min_score ?? 50

          const results = await Promise.allSettled(
            args.symbols.slice(0, 20).map(async (sym: string) => {
              const s = sym.toUpperCase()
              const [research, ownership, redFlags] = await Promise.allSettled([
                c.research.getSummary(s),
                c.institutional.getOwnership(s),
                c.accounting.getRedFlags(s),
              ])
              return { symbol: s, research, ownership, redFlags }
            }),
          )

          const riskLevels: Record<string, number> = { low: 1, medium: 2, high: 3 }
          const maxRiskLevel = args.max_risk === "any" || !args.max_risk ? 99 : (riskLevels[args.max_risk] ?? 99)
          const passing: Array<Record<string, unknown>> = []

          for (const result of results) {
            if (result.status !== "fulfilled") continue
            const { symbol, research, ownership, redFlags } = result.value

            let score = 0
            let rating = "N/A"
            let risk = "unknown"
            let institutional = 0

            if (research.status === "fulfilled") {
              const r = research.value as ApiResult
              if (r.success && r.data) {
                const d = r.data as Record<string, unknown>
                score = (d.overallScore as number) ?? 0
                rating = (d.valuationRating as string) ?? "N/A"
              }
            }

            if (ownership.status === "fulfilled") {
              const r = ownership.value as ApiResult
              if (r.success && r.data) {
                institutional = ((r.data as Record<string, unknown>).institutionalOwnership as number) ?? 0
              }
            }

            if (redFlags.status === "fulfilled") {
              const r = redFlags.value as ApiResult
              if (r.success && r.data) {
                risk = ((r.data as Record<string, unknown>).overallRisk as string) ?? "unknown"
              }
            }

            if (score < minScore) continue
            if (args.require_institutional_buying && institutional < 50) continue
            if (risk !== "unknown" && (riskLevels[risk.toLowerCase()] ?? 0) > maxRiskLevel) continue

            passing.push({ symbol, score, rating, risk, institutional })
          }

          passing.sort((a, b) => (b.score as number) - (a.score as number))
          return JSON.stringify({ screened: args.symbols.length, passed: passing.length, results: passing }, null, 2)
        },
      }),

      // =====================================================================
      // Tier 3: Passthrough
      // =====================================================================

      zee_invest_api: tool({
        description: "Make a raw investing API call. Use only when no specialized tool covers the endpoint.",
        args: {
          method: tool.schema.enum(["GET", "POST", "PUT", "DELETE"]).describe("HTTP method"),
          path: tool.schema.string().describe("API path (e.g., /api/market/AAPL)"),
          body: tool.schema.string().optional().describe("Request body JSON string for POST/PUT"),
        },
        async execute(args) {
          const c = getClient()
          const body = args.body ? JSON.parse(args.body) : undefined
          return fmt(await c.rawRequest(args.method, args.path, { body }))
        },
      }),
    }),
  }
}
