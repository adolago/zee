import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

// Restore module mocks after this test file
afterAll(() => {
  mock.restore()
})

type ApiResult = {
  success: boolean
  data: unknown
  error: string | null
}

class InvestingApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string,
  ) {
    super(message)
    this.name = "InvestingApiError"
  }
}

class InvestingNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvestingNetworkError"
  }
}

class InvestingTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`)
    this.name = "InvestingTimeoutError"
  }
}

class InvestingNotRunningError extends Error {
  constructor(public readonly baseUrl: string) {
    super(`Investing API not running at ${baseUrl}`)
    this.name = "InvestingNotRunningError"
  }
}

class InvestingDaemonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvestingDaemonError"
  }
}

const state = {
  preflightError: null as string | null,
  connectError: null as Error | null,
  connectCalls: 0,
  disconnectCalls: 0,
  researchCalls: [] as string[],
  marketCalls: [] as string[],
  researchBehavior: new Map<string, ApiResult | Error>(),
  marketBehavior: new Map<string, ApiResult | Error>(),
}

function ok(data: unknown): ApiResult {
  return {
    success: true,
    data,
    error: null,
  }
}

function resolveBehavior(
  behavior: Map<string, ApiResult | Error>,
  key: string,
  fallback: ApiResult,
): ApiResult {
  const value = behavior.get(key)
  if (value instanceof Error) throw value
  if (value) return value
  return fallback
}

class NoopRouter {
  async noop(): Promise<ApiResult> {
    return ok({})
  }
}

class MarketRouter {
  async getData(symbol: string): Promise<ApiResult> {
    state.marketCalls.push(`quote:${symbol}`)
    return resolveBehavior(state.marketBehavior, `quote:${symbol}`, ok({ symbol, price: 100 }))
  }

  async getHistory(symbol: string, period?: string, interval?: string): Promise<ApiResult> {
    state.marketCalls.push(`history:${symbol}`)
    return resolveBehavior(state.marketBehavior, `history:${symbol}`, ok({ symbol, period, interval }))
  }

  async getOverview(): Promise<ApiResult> {
    state.marketCalls.push("overview")
    return ok({ market: "overview" })
  }
}

class ResearchRouter {
  async getReport(symbol: string): Promise<ApiResult> {
    state.researchCalls.push(`report:${symbol}`)
    return resolveBehavior(state.researchBehavior, `report:${symbol}`, ok({ symbol, report: true }))
  }

  async getValuation(symbol: string, includeDcf?: boolean): Promise<ApiResult> {
    state.researchCalls.push(`valuation:${symbol}`)
    return resolveBehavior(
      state.researchBehavior,
      `valuation:${symbol}`,
      ok({ symbol, valuation: { forwardPe: 10.5 }, includeDcf: includeDcf ?? true }),
    )
  }

  async getEarnings(symbol: string, quarters?: number): Promise<ApiResult> {
    state.researchCalls.push(`earnings:${symbol}`)
    return resolveBehavior(state.researchBehavior, `earnings:${symbol}`, ok({ symbol, quarters }))
  }

  async getPeers(symbol: string, peers?: string): Promise<ApiResult> {
    state.researchCalls.push(`peers:${symbol}`)
    return resolveBehavior(state.researchBehavior, `peers:${symbol}`, ok({ symbol, peers }))
  }

  async getDCF(symbol: string, options?: Record<string, unknown>): Promise<ApiResult> {
    state.researchCalls.push(`dcf:${symbol}`)
    return resolveBehavior(state.researchBehavior, `dcf:${symbol}`, ok({ symbol, options }))
  }

  async getSummary(symbol: string): Promise<ApiResult> {
    state.researchCalls.push(`summary:${symbol}`)
    return ok({ symbol, overallScore: 70, valuationRating: "fair" })
  }
}

class InvestingClient {
  readonly memory = {
    isConfigured: false,
    onToolResult: async () => {},
  }

  readonly system = new NoopRouter()
  readonly market = new MarketRouter()
  readonly institutional = new NoopRouter()
  readonly analytics = new NoopRouter()
  readonly portfolio = new NoopRouter()
  readonly research = new ResearchRouter()
  readonly commodities = new NoopRouter()
  readonly options = new NoopRouter()
  readonly etf = new NoopRouter()
  readonly macro = new NoopRouter()
  readonly accounting = new NoopRouter()
  readonly signals = new NoopRouter()
  readonly notes = new NoopRouter()

  constructor(_config?: unknown) {}

  async connect(): Promise<void> {
    state.connectCalls += 1
    if (state.connectError) throw state.connectError
  }

  async disconnect(): Promise<void> {
    state.disconnectCalls += 1
  }

  async rawRequest(): Promise<ApiResult> {
    return ok({ raw: true })
  }
}

mock.module("@zee/investing-sdk", () => ({
  InvestingClient,
  InvestingApiError,
  InvestingNetworkError,
  InvestingTimeoutError,
  InvestingNotRunningError,
  InvestingDaemonError,
}))

mock.module("../../src/paths", () => ({
  Investing: {
    preflight: () => state.preflightError,
    apiUrl: () => "http://127.0.0.1:8000",
    coreBin: () => "/mock/investing-core",
    repo: () => "/mock/repo",
  },
}))

const { InvestingPlugin } = await import("../../src/plugin/investing")

function toolContext() {
  return {
    sessionID: "s",
    messageID: "m",
    agent: "zee",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

async function withPlugin(run: (hooks: Awaited<ReturnType<typeof InvestingPlugin>>) => Promise<void>) {
  const hooks = await InvestingPlugin({} as any)
  try {
    await run(hooks)
  } finally {
    await hooks.event?.({ event: { type: "session.end" } } as any)
  }
}

beforeEach(() => {
  state.preflightError = null
  state.connectError = null
  state.connectCalls = 0
  state.disconnectCalls = 0
  state.researchCalls = []
  state.marketCalls = []
  state.researchBehavior.clear()
  state.marketBehavior.clear()
})

describe("plugin.investing", () => {
  test("connects once for repeated requests", async () => {
    await withPlugin(async (hooks) => {
      const research = hooks.tool?.zee_invest_research
      expect(research).toBeDefined()
      if (!research) throw new Error("zee_invest_research tool missing")

      const first = await research.execute({ action: "report", symbol: "AAPL" }, toolContext() as any)
      const second = await research.execute({ action: "report", symbol: "AAPL" }, toolContext() as any)

      expect(state.connectCalls).toBe(1)
      expect(state.researchCalls).toEqual(["report:AAPL", "report:AAPL"])
      expect(first).toContain('"symbol": "AAPL"')
      expect(second).toContain('"symbol": "AAPL"')
    })
  })

  test("returns actionable error when connection fails", async () => {
    state.connectError = new InvestingNetworkError("connection refused")

    await withPlugin(async (hooks) => {
      const research = hooks.tool?.zee_invest_research
      expect(research).toBeDefined()
      if (!research) throw new Error("zee_invest_research tool missing")

      const result = await research.execute({ action: "report", symbol: "AAPL" }, toolContext() as any)
      expect(result).toContain("Error: Unable to reach investing API")
      expect(result).toContain("connection refused")
      expect(state.connectCalls).toBe(1)
    })
  })

  test("returns preflight guidance when backend is not ready", async () => {
    state.preflightError =
      "Investing core binary is not configured. Set ZEE_INVESTING_CORE_BIN to /mock/investing-core."

    await withPlugin(async (hooks) => {
      const research = hooks.tool?.zee_invest_research
      expect(research).toBeDefined()
      if (!research) throw new Error("zee_invest_research tool missing")

      const result = await research.execute({ action: "report", symbol: "AAPL" }, toolContext() as any)
      expect(result).toContain("ZEE_INVESTING_CORE_BIN")
      expect(state.connectCalls).toBe(0)
    })
  })

  test("retries Brazilian ticker with .SA suffix for research valuation", async () => {
    state.researchBehavior.set("valuation:ALPA4", new InvestingApiError("symbol not found", 404, "missing"))
    state.researchBehavior.set("valuation:ALPA4.SA", ok({ symbol: "ALPA4.SA", valuation: { forwardPe: 11.2 } }))

    await withPlugin(async (hooks) => {
      const research = hooks.tool?.zee_invest_research
      expect(research).toBeDefined()
      if (!research) throw new Error("zee_invest_research tool missing")

      const result = await research.execute({ action: "valuation", symbol: "ALPA4" }, toolContext() as any)
      expect(state.researchCalls).toEqual(["valuation:ALPA4", "valuation:ALPA4.SA"])
      expect(result).toContain('"symbol": "ALPA4.SA"')
      expect(result).toContain('"forwardPe": 11.2')
    })
  })

  test("retries Brazilian ticker with .SA suffix for market quote", async () => {
    state.marketBehavior.set("quote:ALPA4", {
      success: false,
      data: null,
      error: "symbol not found",
    })
    state.marketBehavior.set("quote:ALPA4.SA", ok({ symbol: "ALPA4.SA", price: 14.25 }))

    await withPlugin(async (hooks) => {
      const market = hooks.tool?.zee_invest_market
      expect(market).toBeDefined()
      if (!market) throw new Error("zee_invest_market tool missing")

      const result = await market.execute({ action: "quote", symbol: "ALPA4" }, toolContext() as any)
      expect(state.marketCalls).toEqual(["quote:ALPA4", "quote:ALPA4.SA"])
      expect(result).toContain('"symbol": "ALPA4.SA"')
    })
  })

  test("does not retry .SA fallback on non-symbol network failures", async () => {
    state.researchBehavior.set("valuation:ALPA4", new InvestingNetworkError("socket closed"))

    await withPlugin(async (hooks) => {
      const research = hooks.tool?.zee_invest_research
      expect(research).toBeDefined()
      if (!research) throw new Error("zee_invest_research tool missing")

      const result = await research.execute({ action: "valuation", symbol: "ALPA4" }, toolContext() as any)
      expect(state.researchCalls).toEqual(["valuation:ALPA4"])
      expect(result).toContain("socket closed")
    })
  })
})
