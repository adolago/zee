/**
 * Usage API routes for Hono.
 */

import { Hono } from "hono"
import * as Storage from "./storage"
import { formatCost, formatTokens } from "./pricing"
import type { UsagePeriod, UsageEventQuery, UsageSummaryQuery } from "./types"

export const UsageRoute = new Hono()

/**
 * GET /usage/events
 * List usage events with optional filters.
 */
UsageRoute.get("/events", (c) => {
  const query: UsageEventQuery = {
    limit: parseInt(c.req.query("limit") ?? "100", 10),
    offset: parseInt(c.req.query("offset") ?? "0", 10),
    from: c.req.query("from") ? parseInt(c.req.query("from")!, 10) : undefined,
    to: c.req.query("to") ? parseInt(c.req.query("to")!, 10) : undefined,
    providerId: c.req.query("provider") ?? undefined,
    modelId: c.req.query("model") ?? undefined,
    sessionId: c.req.query("session") ?? undefined,
    hasError: c.req.query("hasError") ? c.req.query("hasError") === "true" : undefined,
  }

  try {
    const events = Storage.queryEvents(query)
    const total = Storage.getEventCount()

    return c.json({
      events,
      total,
      limit: query.limit,
      offset: query.offset,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

/**
 * GET /usage/summary
 * Get aggregated usage summary.
 */
UsageRoute.get("/summary", (c) => {
  const query: UsageSummaryQuery = {
    period: (c.req.query("period") as UsagePeriod) ?? "day",
    from: c.req.query("from") ? parseInt(c.req.query("from")!, 10) : undefined,
    to: c.req.query("to") ? parseInt(c.req.query("to")!, 10) : undefined,
    providerId: c.req.query("provider") ?? undefined,
    modelId: c.req.query("model") ?? undefined,
    sessionId: c.req.query("session") ?? undefined,
  }

  try {
    const summary = Storage.getSummary(query)
    return c.json(summary)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

/**
 * GET /usage/summary/provider/:id
 * Get provider-specific summary.
 */
UsageRoute.get("/summary/provider/:id", (c) => {
  const providerId = c.req.param("id")
  const period = (c.req.query("period") as UsagePeriod) ?? "month"

  try {
    const summary = Storage.getSummary({ period, providerId })
    const providerUsage = summary.byProvider[providerId]

    if (!providerUsage) {
      return c.json({ error: "Provider not found or no usage data" }, 404)
    }

    return c.json({
      ...providerUsage,
      period,
      startTime: summary.startTime,
      endTime: summary.endTime,
      models: Object.values(summary.byModel).filter((m) => m.providerId === providerId),
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

/**
 * GET /usage/summary/model/:id
 * Get model-specific summary.
 */
UsageRoute.get("/summary/model/:id", (c) => {
  const modelId = c.req.param("id")
  const period = (c.req.query("period") as UsagePeriod) ?? "month"

  try {
    const summary = Storage.getSummary({ period, modelId })
    const modelUsage = summary.byModel[modelId]

    if (!modelUsage) {
      return c.json({ error: "Model not found or no usage data" }, 404)
    }

    return c.json({
      ...modelUsage,
      period,
      startTime: summary.startTime,
      endTime: summary.endTime,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

/**
 * GET /usage/summary/session/:id
 * Get session-specific summary.
 */
UsageRoute.get("/summary/session/:id", (c) => {
  const sessionId = c.req.param("id")

  try {
    const sessionUsage = Storage.getSessionUsage(sessionId)

    if (!sessionUsage) {
      return c.json({ error: "Session not found or no usage data" }, 404)
    }

    return c.json(sessionUsage)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

/**
 * GET /usage/stats
 * Get quick stats for dashboard.
 */
UsageRoute.get("/stats", (c) => {
  try {
    const stats = Storage.getStats()

    // Add formatted versions for display
    return c.json({
      ...stats,
      formatted: {
        todayCost: formatCost(stats.todayCost),
        weekCost: formatCost(stats.weekCost),
        monthCost: formatCost(stats.monthCost),
        todayTokens: formatTokens(stats.todayTokens),
        topModelCost: stats.topModel ? formatCost(stats.topModel.cost) : undefined,
        topProviderCost: stats.topProvider ? formatCost(stats.topProvider.cost) : undefined,
      },
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

/**
 * GET /usage/cost
 * Get cost breakdown by period and grouping.
 */
UsageRoute.get("/cost", (c) => {
  const period = (c.req.query("period") as UsagePeriod) ?? "month"
  const groupBy = c.req.query("groupBy") ?? "model" // provider | model | session

  try {
    const summary = Storage.getSummary({ period })

    let breakdown: Array<{ id: string; name?: string; cost: number; requests: number; tokens: number }>

    switch (groupBy) {
      case "provider":
        breakdown = Object.values(summary.byProvider).map((p) => ({
          id: p.providerId,
          cost: p.cost,
          requests: p.requests,
          tokens: p.inputTokens + p.outputTokens,
        }))
        break
      case "model":
      default:
        breakdown = Object.values(summary.byModel).map((m) => ({
          id: m.modelId,
          name: m.modelName,
          cost: m.cost,
          requests: m.requests,
          tokens: m.inputTokens + m.outputTokens,
        }))
        break
    }

    // Sort by cost descending
    breakdown.sort((a, b) => b.cost - a.cost)

    return c.json({
      period,
      groupBy,
      startTime: summary.startTime,
      endTime: summary.endTime,
      totalCost: summary.totalCost,
      breakdown,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

/**
 * DELETE /usage/events
 * Purge old events.
 */
UsageRoute.delete("/events", (c) => {
  const before = c.req.query("before")

  if (!before) {
    return c.json({ error: "Missing 'before' timestamp parameter" }, 400)
  }

  try {
    const timestamp = parseInt(before, 10)
    const deleted = Storage.purgeEvents(timestamp)

    return c.json({
      deleted,
      before: new Date(timestamp).toISOString(),
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})
