import { BunProc } from "../bun"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { fetchRegistry, getPlugin, type RegistryPlugin, type Registry } from "./registry"

const log = Log.create({ service: "plugin-manager" })

export interface InstallResult {
  success: boolean
  message: string
  plugin?: RegistryPlugin
}

export interface RemoveResult {
  success: boolean
  message: string
}

export interface InstalledPlugin {
  name: string
  npm: string
  version: string
  spec: string
  fromRegistry: boolean
  registryInfo?: RegistryPlugin
}

/**
 * Install a plugin from the registry
 */
export async function installPlugin(name: string): Promise<InstallResult> {
  const registry = await fetchRegistry()
  const plugin = getPlugin(registry, name)

  if (!plugin) {
    return {
      success: false,
      message: `Plugin "${name}" not found in registry. Use 'zee plugin search' to find available plugins.`,
    }
  }

  const pkgSpec = `${plugin.npm}@${plugin.version}`

  log.info("Installing plugin", { name: plugin.name, spec: pkgSpec })

  try {
    // Install via Bun
    await BunProc.install(plugin.npm, plugin.version)

    // Add to config if not already present
    const config = await Config.get()
    const plugins = [...(config.plugin ?? [])]

    // Check if already installed (any version)
    const existingIdx = plugins.findIndex(
      (p) => typeof p === "string" && (p === plugin.npm || p.startsWith(`${plugin.npm}@`)),
    )

    if (existingIdx >= 0) {
      // Update to new version
      plugins[existingIdx] = pkgSpec
    } else {
      plugins.push(pkgSpec)
    }

    await Config.update({ plugin: plugins })

    log.info("Plugin installed", { name: plugin.name, spec: pkgSpec })
    return {
      success: true,
      message: `Installed ${plugin.displayName} (${pkgSpec})`,
      plugin,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error("Failed to install plugin", { name, error: msg })
    return {
      success: false,
      message: `Failed to install ${name}: ${msg}`,
    }
  }
}

/**
 * Remove a plugin from config
 */
export async function removePlugin(name: string): Promise<RemoveResult> {
  const config = await Config.get()
  const plugins = [...(config.plugin ?? [])]

  // Find plugin in config (could be name or name@version)
  const idx = plugins.findIndex((p) => typeof p === "string" && (p === name || p.startsWith(`${name}@`)))

  if (idx === -1) {
    return {
      success: false,
      message: `Plugin "${name}" not found in config. Use 'zee plugin list' to see installed plugins.`,
    }
  }

  const removed = plugins[idx]
  plugins.splice(idx, 1)

  await Config.update({ plugin: plugins })

  log.info("Plugin removed", { name, spec: removed })
  return {
    success: true,
    message: `Removed ${removed}`,
  }
}

/**
 * List installed plugins with registry info
 */
export async function listInstalled(): Promise<InstalledPlugin[]> {
  const config = await Config.get()
  const configPlugins = (config.plugin ?? []).filter((p): p is string => typeof p === "string")

  let registry: Registry | null = null
  try {
    registry = await fetchRegistry()
  } catch {
    // Continue without registry info
  }

  return configPlugins.map((spec) => {
    // Parse spec (e.g., "zee-anthropic-auth@0.0.11" or legacy "agent-core-anthropic-auth")
    const lastAtIdx = spec.lastIndexOf("@")
    const hasVersion = lastAtIdx > 0
    const npm = hasVersion ? spec.substring(0, lastAtIdx) : spec
    const version = hasVersion ? spec.substring(lastAtIdx + 1) : "latest"

    const registryInfo = registry ? getPlugin(registry, npm) : undefined

    return {
      name: registryInfo?.name ?? npm,
      npm,
      version,
      spec,
      fromRegistry: !!registryInfo,
      registryInfo,
    }
  })
}

/**
 * Check if a plugin is installed
 */
export async function isInstalled(name: string): Promise<boolean> {
  const installed = await listInstalled()
  return installed.some((p) => p.name === name || p.npm === name)
}

/**
 * Get details about an installed plugin
 */
export async function getInstalled(name: string): Promise<InstalledPlugin | undefined> {
  const installed = await listInstalled()
  return installed.find((p) => p.name === name || p.npm === name)
}
