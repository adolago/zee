import { z } from "zod"
import { Log } from "../util/log"
import { Global } from "../global"
import * as fs from "node:fs/promises"
import * as path from "node:path"

const log = Log.create({ service: "plugin-registry" })

const RegistryPluginSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  npm: z.string(),
  version: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  capabilities: z.array(z.string()),
  author: z.string(),
  homepage: z.string().optional(),
})

const RegistrySchema = z.object({
  version: z.number(),
  plugins: z.array(RegistryPluginSchema),
  categories: z.array(z.string()),
})

export type RegistryPlugin = z.infer<typeof RegistryPluginSchema>
export type Registry = z.infer<typeof RegistrySchema>

const REGISTRY_URL = "https://raw.githubusercontent.com/adolago/agent-core/dev/plugins/index.json"
const CACHE_TTL = 3600000 // 1 hour
const CACHE_FILE = "plugin-registry.json"

interface CachedRegistry {
  data: Registry
  timestamp: number
}

let memoryCache: CachedRegistry | null = null

async function getCachePath(): Promise<string> {
  return path.join(Global.Path.cache, CACHE_FILE)
}

async function readCacheFile(): Promise<CachedRegistry | null> {
  try {
    const cachePath = await getCachePath()
    const content = await fs.readFile(cachePath, "utf-8")
    const parsed = JSON.parse(content)
    // Validate cached data has expected structure
    if (!parsed.data || typeof parsed.timestamp !== "number") {
      return null
    }
    // Validate the registry data itself
    RegistrySchema.parse(parsed.data)
    return parsed as CachedRegistry
  } catch {
    return null
  }
}

async function writeCacheFile(cached: CachedRegistry): Promise<void> {
  try {
    const cachePath = await getCachePath()
    await fs.mkdir(path.dirname(cachePath), { recursive: true })
    await fs.writeFile(cachePath, JSON.stringify(cached, null, 2))
  } catch (error) {
    log.warn("Failed to write registry cache", { error })
  }
}

export async function fetchRegistry(forceRefresh = false): Promise<Registry> {
  // Check memory cache first
  if (!forceRefresh && memoryCache && Date.now() - memoryCache.timestamp < CACHE_TTL) {
    return memoryCache.data
  }

  // Check file cache
  if (!forceRefresh) {
    const fileCache = await readCacheFile()
    if (fileCache && Date.now() - fileCache.timestamp < CACHE_TTL) {
      memoryCache = fileCache
      return fileCache.data
    }
  }

  // Fetch from remote
  log.info("Fetching plugin registry", { url: REGISTRY_URL })
  try {
    const response = await fetch(REGISTRY_URL)
    if (!response.ok) {
      throw new Error(`Failed to fetch registry: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const registry = RegistrySchema.parse(data)

    const cached: CachedRegistry = { data: registry, timestamp: Date.now() }
    memoryCache = cached
    await writeCacheFile(cached)

    log.info("Registry fetched", { plugins: registry.plugins.length })
    return registry
  } catch (error) {
    // If fetch fails, try to use stale cache
    const staleCache = memoryCache || (await readCacheFile())
    if (staleCache) {
      log.warn("Using stale registry cache", { error })
      return staleCache.data
    }
    throw error
  }
}

export function searchPlugins(registry: Registry, query: string): RegistryPlugin[] {
  const q = query.toLowerCase().trim()
  if (!q) return registry.plugins

  return registry.plugins.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.displayName.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q)) ||
      p.category.toLowerCase().includes(q),
  )
}

export function getPlugin(registry: Registry, name: string): RegistryPlugin | undefined {
  return registry.plugins.find((p) => p.name === name || p.npm === name)
}

export function filterByCategory(registry: Registry, category: string): RegistryPlugin[] {
  return registry.plugins.filter((p) => p.category === category)
}

export function filterByCapability(registry: Registry, capability: string): RegistryPlugin[] {
  return registry.plugins.filter((p) => p.capabilities.includes(capability))
}
