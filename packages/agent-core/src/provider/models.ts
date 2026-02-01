import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import z from "zod"
import { data } from "./models-macro" with { type: "macro" }

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  // Use getter to ensure path is evaluated at runtime, not module load time
  // This is necessary for test isolation where XDG_CACHE_HOME is set dynamically
  function getFilepath() {
    return path.join(Global.Path.cache, "models.json")
  }

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning", "reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  const STALENESS_MS = 24 * 60 * 60 * 1000 // 24 hours

  export async function get() {
    // Fire-and-forget background refresh if cache is stale
    refreshIfStale()
    const file = Bun.file(getFilepath())
    const result = await file.json().catch(() => {})
    if (result) return result as Record<string, Provider>
    // Fallback: macro may not be available in test mode, fetch directly
    if (typeof data === "function") {
      const json = await data()
      return JSON.parse(json) as Record<string, Provider>
    }
    // Direct fetch as final fallback
    const response = await fetch(`${Global.Path.modelsDevUrl}/api.json`)
    return (await response.json()) as Record<string, Provider>
  }

  /**
   * Check cache staleness and refresh in background if older than STALENESS_MS.
   */
  function refreshIfStale() {
    const filepath = getFilepath()
    fs.stat(filepath)
      .then((stat) => {
        const age = Date.now() - stat.mtimeMs
        if (age > STALENESS_MS) {
          log.debug("models cache stale", { ageHours: Math.round(age / 3600000) })
          refresh().catch(() => {})
        }
      })
      .catch(() => {
        // No cache file exists, trigger refresh
        refresh().catch(() => {})
      })
  }

  /**
   * Fetch the latest model catalog from models.dev and write to cache.
   */
  export async function refresh() {
    const url = `${Global.Path.modelsDevUrl}/api.json`
    const filepath = getFilepath()
    log.info("refreshing models from", { url })
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        log.warn("models refresh failed", { status: response.status })
        return
      }
      const json = await response.text()
      // Validate it's parseable before writing
      JSON.parse(json)
      await fs.mkdir(path.dirname(filepath), { recursive: true })
      await Bun.file(filepath).write(json)
      log.info("models cache updated", { filepath })
    } catch (e) {
      log.warn("models refresh error", { error: String(e) })
    }
  }
}
