import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"

interface Context {
  directory: string
  worktree: string
  project: Project.Info
}
const context = Context.create<Context>("instance")

type CacheEntry = {
  promise: Promise<Context>
  refs: number
  lastUsedAt: number
  lastUsedSeq: number
  disposing: boolean
}

const cache = new Map<string, CacheEntry>()
let useSeq = 0
let evictionInFlight: Promise<number> | null = null
const BOOTSTRAP_CONCURRENCY = 3
let bootstrapActive = 0
const bootstrapQueue: Array<() => void> = []

async function withBootstrapLimit<T>(fn: () => Promise<T>) {
  if (bootstrapActive >= BOOTSTRAP_CONCURRENCY) {
    await new Promise<void>((resolve) => bootstrapQueue.push(resolve))
  }

  bootstrapActive++
  try {
    return await fn()
  } finally {
    bootstrapActive--
    bootstrapQueue.shift()?.()
  }
}

function touch(entry: CacheEntry) {
  entry.lastUsedAt = Date.now()
  entry.lastUsedSeq = ++useSeq
}

function evictionConfig(): {
  maxInstances?: number
  ttlMs?: number
} {
  const maxInstances = Flag.ZEE_INSTANCE_CACHE_MAX_INSTANCES
  const ttlSeconds = Flag.ZEE_INSTANCE_CACHE_TTL_SECONDS
  const ttlMs = ttlSeconds ? ttlSeconds * 1000 : undefined
  return { maxInstances, ttlMs }
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const directory = Filesystem.sanitizePath(input.directory)
    let entry = cache.get(directory)
    if (!entry) {
      Log.Default.info("creating instance", { directory })
      const promise = withBootstrapLimit(async () =>
        iife(async () => {
          const { project, sandbox } = await Project.fromDirectory(directory)
          const ctx = {
            directory,
            worktree: sandbox,
            project,
          }
          await context.provide(ctx, async () => {
            await input.init?.()
          })
          return ctx
        }),
      ).catch((err) => {
        // If initialization fails, don't poison the cache with a rejected promise.
        cache.delete(directory)
        throw err
      })
      entry = {
        promise,
        refs: 0,
        lastUsedAt: Date.now(),
        lastUsedSeq: ++useSeq,
        disposing: false,
      }
      cache.set(directory, entry)
    }

    entry.refs++
    touch(entry)

    let ctx: Context
    try {
      ctx = await entry.promise
    } catch (err) {
      entry.refs--
      throw err
    }

    return context.provide(ctx, async () => {
      try {
        return await input.fn()
      } finally {
        entry.refs--
        touch(entry)
        // Best-effort eviction; intentionally does not block normal execution.
        void Instance.evict()
      }
    })
  },
  cacheSize() {
    return cache.size
  },
  cachedDirectories() {
    return Array.from(cache.keys()).sort()
  },
  isCached(directory: string) {
    return cache.has(Filesystem.sanitizePath(directory))
  },
  async evict(): Promise<number> {
    const cfg = evictionConfig()
    if (!cfg.ttlMs && !cfg.maxInstances) return 0

    if (evictionInFlight) return evictionInFlight

    evictionInFlight = (async () => {
      let evicted = 0
      try {
        const now = Date.now()

        // TTL eviction
        if (cfg.ttlMs) {
          const candidates: string[] = []
          for (const [key, entry] of cache) {
            if (entry.refs > 0) continue
            if (entry.disposing) continue
            if (now - entry.lastUsedAt < cfg.ttlMs) continue
            candidates.push(key)
          }
          for (const key of candidates) {
            const ok = await Instance.disposeDirectory(key)
            if (ok) evicted++
          }
        }

        // LRU eviction
        if (cfg.maxInstances && cache.size > cfg.maxInstances) {
          const candidates: { key: string; seq: number }[] = []
          for (const [key, entry] of cache) {
            if (entry.refs > 0) continue
            if (entry.disposing) continue
            candidates.push({ key, seq: entry.lastUsedSeq })
          }
          candidates.sort((a, b) => a.seq - b.seq)

          for (const candidate of candidates) {
            if (cache.size <= cfg.maxInstances) break
            const ok = await Instance.disposeDirectory(candidate.key)
            if (ok) evicted++
          }
        }
      } catch (error) {
        Log.Default.debug("instance cache eviction failed", { error: String(error) })
      }
      return evicted
    })().finally(() => {
      evictionInFlight = null
    })

    return evictionInFlight
  },
  async disposeDirectory(directory: string): Promise<boolean> {
    const key = Filesystem.sanitizePath(directory)
    const entry = cache.get(key)
    if (!entry) return false
    if (entry.disposing) return false
    if (entry.refs > 0) return false

    entry.disposing = true
    try {
      const awaited = await entry.promise.catch((err) => {
        Log.Default.debug("failed to await instance during disposal", { key, error: String(err) })
        return undefined
      })

      if (!awaited) {
        cache.delete(key)
        return false
      }

      await context.provide(awaited, async () => {
        await Instance.dispose()
      })

      return true
    } catch (error) {
      Log.Default.error("failed to dispose instance", { key, error: String(error) })
      return false
    } finally {
      entry.disposing = false
    }
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string) {
    if (Filesystem.isSuspiciousHardlinkSync(filepath)) return false
    if (Filesystem.containsResolvedSync(Instance.directory, filepath)) return true
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
    if (Instance.worktree === "/") return false
    return Filesystem.containsResolvedSync(Instance.worktree, filepath)
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async dispose() {
    Log.Default.info("disposing instance", { directory: Instance.directory })
    await State.dispose(Instance.directory)
    cache.delete(Instance.directory)
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory: Instance.directory,
        },
      },
    })
  },
  async disposeAll() {
    Log.Default.info("disposing all instances")
    const keys = Array.from(cache.keys())
    for (const key of keys) {
      await Instance.disposeDirectory(key)
    }
  },
}
