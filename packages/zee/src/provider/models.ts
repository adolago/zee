import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  let configuredUrl: string | undefined
  let configuredPath: string | undefined

  function normalizeConfigValue(value: string | undefined): string | undefined {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
  }

  // Use getter to ensure path is evaluated at runtime, not module load time
  // This is necessary for test isolation where XDG_CACHE_HOME is set dynamically
  function getFilepath() {
    return path.join(Global.Path.cache, "models.json")
  }

  function getUrl() {
    return process.env.ZEE_MODELS_URL || Flag.ZEE_MODELS_URL || configuredUrl || "https://models.dev"
  }

  function getPath() {
    return process.env.ZEE_MODELS_PATH || Flag.ZEE_MODELS_PATH || configuredPath || getFilepath()
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
    streaming: z.boolean().optional(),
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

  export function configure(options: { url?: string; path?: string } = {}) {
    configuredUrl = normalizeConfigValue(options.url)
    configuredPath = normalizeConfigValue(options.path)
    Data.reset()
  }

  export const Data = lazy(async () => {
    const file = Bun.file(getPath())
    const result = await file.json().catch(() => {})
    if (result) return result
    // @ts-ignore
    const snapshot = await import("./models-snapshot")
      .then((m) => m.snapshot as Record<string, unknown>)
      .catch(() => undefined)
    if (snapshot) return snapshot
    if (Flag.ZEE_DISABLE_MODELS_FETCH) return {}
    const json = await fetch(`${getUrl()}/api.json`).then((x) => x.text())
    return JSON.parse(json)
  })

  export async function get() {
    const result = await Data()
    return result as Record<string, Provider>
  }

  /**
   * Fetch the latest model catalog from models.dev and write to cache.
   */
  export async function refresh(options: { timeoutMs?: number } = {}) {
    const filepath = getPath()
    log.info("refreshing models from", { url: `${getUrl()}/api.json` })
    const result = await fetch(`${getUrl()}/api.json`, {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 2000),
    }).catch((e) => {
      log.warn("models refresh error", {
        error: e,
      })
    })
    if (result && result.ok) {
      await Bun.write(filepath, await result.text())
      ModelsDev.Data.reset()
    }
  }
}

function shouldAutoRefreshModels(): boolean {
  if (Flag.ZEE_DISABLE_MODELS_FETCH) return false

  // Avoid starting a network request for one-shot commands (e.g. `zee compare`)
  // which should exit immediately.
  const argv = process.argv.slice(2).filter(Boolean)
  const cmd = argv[0]
  if (cmd === "daemon" || cmd === "serve") return true

  return false
}

if (shouldAutoRefreshModels()) {
  void ModelsDev.refresh({ timeoutMs: 2000 })
  setInterval(
    async () => {
      await ModelsDev.refresh({ timeoutMs: 5000 })
    },
    60 * 1000 * 60,
  ).unref()
}
