import type { Hooks, PluginInput, Plugin as PluginInstance } from "@zee/plugin"
export * from "../pkg/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createZeeClient } from "@zee/sdk"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { CodexAuthPlugin } from "./codex"
import { Session } from "../session"
import { NamedError } from "@zee/util/error"
import { KimiAuthPlugin } from "./kimi"
import path from "path"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const BUILTIN: string[] = []

  // Built-in plugins that are directly imported (not installed from npm)
  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, KimiAuthPlugin]

  const state = Instance.state(async () => {
    const { Server } = await import("../server/server")
    const client = createZeeClient({
      baseUrl: Server.url().origin,
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const config = await Config.get()
    const hooks: Hooks[] = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: Server.url(),
      $: Bun.$,
    }

    for (const plugin of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      const init = await plugin(input)
      hooks.push(init)
    }

    const configPlugins = config.plugin ?? []
    const configNames = new Set(configPlugins.map((item) => Config.getPluginName(item)))
    const builtinNames = new Set(BUILTIN.map((item) => Config.getPluginName(item)))

    // Built-in plugins are lowest precedence; config plugins override by name.
    const plugins = Config.deduplicatePlugins([...(BUILTIN ?? []), ...configPlugins])

    for (let plugin of plugins) {
      const pluginName = Config.getPluginName(plugin)
      const isBuiltin = builtinNames.has(pluginName) && !configNames.has(pluginName)

      log.info("loading plugin", { path: plugin })
      if (!plugin.startsWith("file://")) {
        const { name: pkg, subpath, version } = parsePluginSpecifier(plugin)
        let installed = await BunProc.install(pkg, version).catch((err) => {
          if (!isBuiltin) throw err

          const message = err instanceof Error ? err.message : String(err)
          log.error("failed to install builtin plugin", {
            pkg,
            version,
            error: message,
          })
          Bus.publish(Session.Event.Error, {
            error: new NamedError.Unknown({
              message: `Failed to install built-in plugin ${pkg}@${version}: ${message}`,
            }).toObject(),
          })

          return ""
        })
        if (!installed) continue
        plugin = subpath ? await resolveSubpath(installed, subpath) : installed
      }
      let mod: Record<string, PluginInstance>
      try {
        mod = await import(plugin)
      } catch (err) {
        if (!isBuiltin) throw err

        const message = err instanceof Error ? err.message : String(err)
        log.error("failed to load builtin plugin", {
          plugin: pluginName,
          error: message,
        })
        Bus.publish(Session.Event.Error, {
          error: new NamedError.Unknown({
            message: `Failed to load built-in plugin ${pluginName}: ${message}`,
          }).toObject(),
        })
        continue
      }
      // Prevent duplicate initialization when plugins export the same function
      // as both a named export and default export (e.g., `export const X` and `export default X`).
      // Object.entries(mod) would return both entries pointing to the same function reference.
      const seen = new Set<PluginInstance>()
      for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
        if (seen.has(fn)) continue
        seen.add(fn)
        const init = await fn(input)
        hooks.push(init)
      }
    }

    return {
      hooks,
      input,
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = hook[name]
      if (!fn) continue
      // @ts-expect-error if you feel adventurous, please fix the typing, make sure to bump the try-counter if you
      // give up.
      // try-counter: 2
      await fn(input, output)
    }
    return output
  }

  export async function list() {
    return state().then((x) => x.hooks)
  }

  export async function init() {
    const hooks = await state().then((x) => x.hooks)
    const config = await Config.get()
    for (const hook of hooks) {
      // @ts-expect-error this is because we haven't moved plugin to sdk v2
      await hook.config?.(config)
    }
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        hook["event"]?.({
          event: input,
        })
      }
    })
  }

  function parsePluginSpecifier(specifier: string): { name: string; subpath: string | null; version: string } {
    let version = "latest"
    const lastAtIndex = specifier.lastIndexOf("@")
    if (lastAtIndex > 0) {
      version = specifier.substring(lastAtIndex + 1)
      specifier = specifier.substring(0, lastAtIndex)
    }

    if (specifier.startsWith("@")) {
      const parts = specifier.split("/")
      return {
        name: parts.slice(0, 2).join("/"),
        subpath: parts.length > 2 ? parts.slice(2).join("/") : null,
        version,
      }
    }

    const slashIndex = specifier.indexOf("/")
    if (slashIndex > 0) {
      return {
        name: specifier.substring(0, slashIndex),
        subpath: specifier.substring(slashIndex + 1),
        version,
      }
    }

    return { name: specifier, subpath: null, version }
  }

  async function resolveSubpath(installed: string, subpath: string) {
    const pkg = (await Bun.file(path.join(installed, "package.json")).json().catch(() => null)) as
      | { exports?: Record<string, unknown> }
      | null
    const resolved = resolveExportEntry(pkg?.exports?.[`./${subpath}`])
    return path.join(installed, resolved ?? subpath)
  }

  function resolveExportEntry(entry: unknown): string | null {
    if (typeof entry === "string") return entry
    if (entry && typeof entry === "object") {
      const value = entry as Record<string, unknown>
      if (typeof value.import === "string") return value.import
      if (typeof value.default === "string") return value.default
    }
    return null
  }
}
