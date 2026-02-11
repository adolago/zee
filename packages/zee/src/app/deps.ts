import { Context } from "@/util/context"

export type AppDeps = {
  pluginTrigger: typeof import("@/plugin").Plugin.trigger
  nowMs: () => number
}

const context = Context.create<AppDeps>("app.deps")

// Avoid importing "@/plugin" at module load time:
// plugin depends on session, session depends on processor/llm, and those depend on AppDeps.
// A static import here creates a circular dependency that can initialize Plugin as undefined.
let cachedPluginModule: typeof import("@/plugin") | undefined
async function getPluginModule(): Promise<typeof import("@/plugin")> {
  if (cachedPluginModule) return cachedPluginModule
  cachedPluginModule = await import("@/plugin")
  return cachedPluginModule
}

const defaultPluginTrigger: AppDeps["pluginTrigger"] = (async (name: any, input: any, output: any) => {
  const { Plugin } = await getPluginModule()
  return Plugin.trigger(name, input, output)
}) as any

const defaultDeps: AppDeps = {
  pluginTrigger: defaultPluginTrigger,
  nowMs: () => Date.now(),
}

export const AppDeps = {
  use(): AppDeps {
    try {
      return context.use()
    } catch (e) {
      if (e instanceof Context.NotFound) return defaultDeps
      throw e
    }
  },
  provide<R>(overrides: Partial<AppDeps>, fn: () => R): R {
    return context.provide({ ...AppDeps.use(), ...overrides }, fn)
  },
}
