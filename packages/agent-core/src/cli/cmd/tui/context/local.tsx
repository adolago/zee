import { createStore } from "solid-js/store"
import { batch, createEffect, createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme, resolveTheme } from "@tui/context/theme"
import { uniqueBy } from "remeda"
import path from "path"
import { Global } from "@/global"
import { iife } from "@/util/iife"
import { createSimpleContext } from "./helper"
import { useToast } from "../ui/toast"
import { Provider } from "@/provider/provider"
import { useArgs } from "./args"
import { useSDK } from "./sdk"
import { RGBA } from "@opentui/core"
import type { Agent as SDKAgent } from "@opencode-ai/sdk/v2"

// Extended agent type with fallback model support (internal feature not yet in SDK)
type AgentWithFallback = SDKAgent & {
  fallback?: { providerID: string; modelID: string }
  knowledge?: string[]
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const sdk = useSDK()
    const toast = useToast()

    function isModelValid(model: { providerID: string; modelID: string }) {
      const providers = sync.data?.provider
      if (!providers || !Array.isArray(providers)) return false
      const provider = providers.find((x) => x.id === model.providerID)
      return !!provider?.models[model.modelID]
    }

    function getFirstValidModel(...modelFns: (() => { providerID: string; modelID: string } | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    const agent = iife(() => {
      const agents = createMemo((): AgentWithFallback[] => {
        const list = sync.data?.agent as AgentWithFallback[] | undefined
        if (!list || !Array.isArray(list)) return []
        return list
          .filter((x) => x.mode !== "subagent" && !x.hidden)
          .sort((a, b) => b.name.localeCompare(a.name)) // Reverse alpha: Zee, Stanley, Johny
      })
      const [agentStore, setAgentStore] = createStore<{
        current: string
      }>({
        current: agents()?.[0]?.name ?? "",
      })

      // Effect to initialize agent selection when agents load
      // This ensures reactivity works correctly when sync.data.agent populates
      createEffect(() => {
        const list = agents()
        if (list.length > 0 && !agentStore.current) {
          setAgentStore("current", list[0].name)
        }
      })

      const themeCtx = useTheme()
      const { theme } = themeCtx

      // Effect to switch theme when agent changes (based on agent name)
      createEffect(() => {
        const agentName = agentStore.current?.toLowerCase()
        if (agentName && themeCtx.all()[agentName]) {
          themeCtx.set(agentName)
        }
      })

      // Vim mode colors (defined in prompt/index.tsx):
      // - Normal: theme.accent (blue) - matches "N" indicator
      // - Insert: theme.success (green) - "I" indicator
      // - Visual: theme.warning (yellow) - "V" indicator
      // Note: User message colors use persona's theme accent color:
      // - Zee: zeeAccent (#6995E8)
      // - Stanley: stanleyAccent (#78E89C)
      // - Johny: johnyAccent (#E87D6E)
      const colors = createMemo(() => [
        theme.secondary,
        theme.accent,
        theme.success,
        theme.warning,
        theme.primary,
        theme.error,
      ])

      // Get persona's accent color from their theme (brighter, more vibrant)
      function getPersonaAccentColor(agentName: string): RGBA | null {
        const name = agentName.toLowerCase()

        // Map persona names to their theme keys
        const personaThemes: Record<string, string> = {
          zee: "zee",
          stanley: "stanley",
          johny: "johny",
        }

        const themeKey = personaThemes[name]
        if (!themeKey) return null

        // Get the persona's theme
        const personaTheme = themeCtx.all()[themeKey]
        if (!personaTheme) return null

        // Return accent color from that theme (brighter than primary)
        const resolvedTheme = resolveTheme(personaTheme, themeCtx.mode())
        return resolvedTheme.accent
      }

      // Placeholder agent for when no agents are loaded yet
      const placeholderAgent = {
        name: "",
        mode: "all" as const,
        permission: [],
        options: {},
        model: undefined as { providerID: string; modelID: string } | undefined,
        fallback: undefined as { providerID: string; modelID: string } | undefined,
        knowledge: [],
      }

      return {
        list() {
          return agents() ?? []
        },
        current() {
          const list = agents() ?? []
          // Find matching agent, or fallback to first agent if current doesn't match
          const found = list.find((x) => x.name === agentStore.current)
          if (found) return found
          // Update store to first agent if we had a stale value
          const first = list[0]
          if (first) {
            if (agentStore.current !== first.name) {
              setAgentStore("current", first.name)
            }
            return first
          }
          // Return placeholder if no agents loaded yet
          return placeholderAgent
        },
        set(name: string) {
          const list = agents() ?? []
          if (!list.some((x) => x.name === name))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${name}`,
              duration: 3000,
            })
          setAgentStore("current", name)
        },
        move(direction: 1 | -1) {
          batch(() => {
            const list = agents() ?? []
            if (list.length === 0) return
            let next = list.findIndex((x) => x.name === agentStore.current) + direction
            if (next < 0) next = list.length - 1
            if (next >= list.length) next = 0
            const value = list[next]
            if (value) setAgentStore("current", value.name)
          })
        },
        color(name: string) {
          const all = sync.data?.agent
          if (!all || !Array.isArray(all)) return colors()[0]
          const agent = all.find((x) => x.name.toLowerCase() === name.toLowerCase())

          // First check for agent's custom color property
          if (agent?.color) return RGBA.fromHex(agent.color)

          // Check if this is a persona and use their theme's accent color
          const personaColor = getPersonaAccentColor(name)
          if (personaColor) return personaColor

          // Fall back to indexed colors for other agents
          const index = all.findIndex((x) => x.name.toLowerCase() === name.toLowerCase())
          if (index === -1) return colors()[0]
          return colors()[index % colors().length]
        },
      }
    })

    const model = iife(() => {
      const [modelStore, setModelStore] = createStore<{
        ready: boolean
        // Session-scoped model selection (keyed by agentName, clears on session change)
        sessionModel: Record<string, { providerID: string; modelID: string }>
        sessionID: string | null
        // Fallback toggle state (per agent, session-scoped)
        useFallback: Record<string, boolean>
        favorite: {
          providerID: string
          modelID: string
        }[]
        variant: Record<string, string | undefined>
      }>({
        ready: false,
        sessionModel: {},
        sessionID: null,
        useFallback: {},
        favorite: [],
        variant: {},
      })

      const file = Bun.file(path.join(Global.Path.state, "model.json"))
      const state = {
        pending: false,
      }

      function save() {
        if (!modelStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        // Only persist favorite, variant - NOT session model
        Bun.write(
          file,
          JSON.stringify({
            favorite: modelStore.favorite,
            variant: modelStore.variant,
          }),
        )
      }

      file
        .json()
        .then((x) => {
          if (Array.isArray(x.favorite)) setModelStore("favorite", x.favorite)
          if (typeof x.variant === "object" && x.variant !== null) setModelStore("variant", x.variant)
        })
        .catch(() => {})
        .finally(() => {
          setModelStore("ready", true)
          if (state.pending) save()
        })

      const args = useArgs()
      const fallbackModel = createMemo(() => {
        // Explicitly track provider array to ensure reactivity when providers load
        const providers = sync.data.provider
        const providerCount = providers.length

        if (args.model) {
          const { providerID, modelID } = Provider.parseModel(args.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        if (sync.data.config.model) {
          const { providerID, modelID } = Provider.parseModel(sync.data.config.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        if (providerCount === 0) return undefined
        const provider = providers[0]
        if (!provider) return undefined
        const defaultModel = sync.data.provider_default[provider.id]
        const firstModel = Object.values(provider.models)[0]
        const model = defaultModel ?? firstModel?.id
        if (!model) return undefined
        return {
          providerID: provider.id,
          modelID: model,
        }
      })

      const currentModel = createMemo(() => {
        const a = agent.current()
        // If using placeholder agent (no name), don't return any model yet
        if (!a?.name) {
          return undefined
        }
        // Check if fallback mode is active for this agent
        const isFallbackActive = modelStore.useFallback[a.name] ?? false
        if (isFallbackActive && a.fallback) {
          // Use agent's fallback model when toggle is active
          return a.fallback
        }
        // Session-scoped user selection takes priority (allows overriding agent defaults within session)
        const sessionSelection = modelStore.sessionModel[a.name]
        if (sessionSelection && isModelValid(sessionSelection)) {
          return sessionSelection
        }
        // Fall back to agent's configured model (trust without validation for custom models)
        if (a.model) {
          return a.model
        }
        // Finally, try global fallback
        return fallbackModel() ?? undefined
      })

      return {
        current: currentModel,
        get ready() {
          return modelStore.ready
        },
        favorite() {
          return modelStore.favorite
        },
        // Called when session changes - clears session-scoped model selection and fallback toggle
        setSession(sessionID: string | null) {
          if (modelStore.sessionID !== sessionID) {
            setModelStore("sessionID", sessionID)
            setModelStore("sessionModel", {}) // Clear session model on session change
            setModelStore("useFallback", {}) // Clear fallback toggle on session change
          }
        },
        // Toggle between primary and fallback model for current agent
        toggleFallback() {
          const a = agent.current()
          if (!a?.name || !a.fallback) return false
          const current = modelStore.useFallback[a.name] ?? false
          setModelStore("useFallback", a.name, !current)
          return !current
        },
        // Check if fallback mode is active for current agent
        isFallbackActive() {
          const a = agent.current()
          if (!a?.name) return false
          return modelStore.useFallback[a.name] ?? false
        },
        // Check if current agent has a fallback configured
        hasFallback() {
          const a = agent.current()
          return !!a?.fallback
        },
        parsed: createMemo(() => {
          const value = currentModel()
          if (!value) {
            const agents = sync.data?.agent
            if (sync.status === "complete" && (!Array.isArray(agents) || agents.length === 0)) {
              return {
                provider: "Agents unavailable",
                model: "Check daemon/config",
                reasoning: false,
              }
            }
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
            }
          }
          const provider = sync.data.provider.find((x) => x.id === value.providerID)
          const info = provider?.models[value.modelID]
          return {
            provider: provider?.name ?? value.providerID,
            model: info?.name ?? value.modelID,
            reasoning: info?.capabilities?.reasoning ?? false,
          }
        }),
        set(model: { providerID: string; modelID: string }) {
          if (!isModelValid(model)) {
            toast.show({
              message: `Model ${model.providerID}/${model.modelID} is not valid`,
              variant: "warning",
              duration: 3000,
            })
            return
          }
          // Store in session-scoped model (not persisted)
          setModelStore("sessionModel", agent.current().name, model)
        },
        variant: {
          current() {
            const m = currentModel()
            if (!m) return undefined
            const key = `${m.providerID}/${m.modelID}`
            return modelStore.variant[key]
          },
          list() {
            const m = currentModel()
            if (!m) return []
            const provider = sync.data.provider.find((x) => x.id === m.providerID)
            const info = provider?.models[m.modelID]
            if (!info?.variants) return []
            return Object.keys(info.variants)
          },
          set(value: string | undefined) {
            const m = currentModel()
            if (!m) return
            const key = `${m.providerID}/${m.modelID}`
            setModelStore("variant", key, value)
            save()
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            const current = this.current()
            if (!current) {
              this.set(variants[0])
              return
            }
            const index = variants.indexOf(current)
            if (index === -1 || index === variants.length - 1) {
              this.set(undefined)
              return
            }
            this.set(variants[index + 1])
          },
        },
      }
    })

    const mcp = {
      isEnabled(name: string) {
        const status = sync.data.mcp[name]
        return status?.status === "connected"
      },
      async toggle(name: string) {
        const status = sync.data.mcp[name]
        if (status?.status === "connected") {
          // Disable: disconnect the MCP
          await sdk.client.mcp.disconnect({ name })
        } else {
          // Enable/Retry: connect the MCP (handles disabled, failed, and other states)
          await sdk.client.mcp.connect({ name })
        }
      },
    }

    // Hold/Release mode - per-session, controls whether the persona can edit files or only research
    const mode = iife(() => {
      // Track which session we're looking at for mode
      let activeSessionID: string | null = null

      function resolveHold(): boolean {
        if (!activeSessionID) return true // Default to hold when no session
        const session = sync.session.get(activeSessionID) as
          | (ReturnType<typeof sync.session.get> & { mode?: "hold" | "release"; surface?: string })
          | undefined
        if (!session) return true
        // Per-session mode
        if (session.mode === "hold") return true
        if (session.mode === "release") return false
        // Surface defaults: messaging surfaces default to release
        if (session.surface === "whatsapp" || session.surface === "telegram") return false
        return true // TUI default to hold
      }

      async function setSessionMode(mode: "hold" | "release") {
        if (!activeSessionID) return
        try {
          await sdk.client.session.mode({ sessionID: activeSessionID, mode })
        } catch (e) {
          // Silently fail, mode will stay as-is
        }
      }

      return {
        setSession(sessionID: string | null) {
          activeSessionID = sessionID
        },
        isHold() {
          return resolveHold()
        },
        isRelease() {
          return !resolveHold()
        },
        toggle() {
          const newMode = resolveHold() ? "release" : "hold"
          setSessionMode(newMode)
          toast.show({
            variant: newMode === "hold" ? "info" : "success",
            message: newMode === "hold" ? "HOLD mode - Research only" : "RELEASE mode - Can edit files",
            duration: 2000,
          })
        },
        setHold() {
          if (resolveHold()) return
          setSessionMode("hold")
        },
        setRelease() {
          if (!resolveHold()) return
          setSessionMode("release")
        },
      }
    })

    // Warn if agent's configured model is invalid (but don't override selection)
    createEffect(() => {
      const value = agent.current()
      if (value.model && !isModelValid(value.model)) {
        toast.show({
          variant: "warning",
          message: `Agent ${value.name}'s configured model ${value.model.providerID}/${value.model.modelID} is not available`,
          duration: 3000,
        })
      }
    })

    // Session parameter overrides (temperature, topP, thinking effort, max tokens)
    const parameters = iife(() => {
      interface SessionParams {
        temperature?: number
        topP?: number
        topK?: number
        thinkingEffort?: "low" | "medium" | "high" | "max"
        maxOutputTokens?: number
      }

      const [paramStore, setParamStore] = createStore<{
        sessionParams: Record<string, SessionParams>
      }>({
        sessionParams: {},
      })

      const paramsFile = Bun.file(path.join(Global.Path.state, "params.json"))

      function saveParams() {
        Bun.write(paramsFile, JSON.stringify(paramStore.sessionParams))
      }

      // Load persisted params
      paramsFile
        .json()
        .then((x) => {
          if (typeof x === "object" && x !== null) {
            setParamStore("sessionParams", x as Record<string, SessionParams>)
          }
        })
        .catch(() => {})

      return {
        get(sessionID: string | undefined): SessionParams {
          if (!sessionID) return {}
          return paramStore.sessionParams[sessionID] ?? {}
        },
        set(sessionID: string | undefined, params: Partial<SessionParams>) {
          if (!sessionID) return
          batch(() => {
            setParamStore("sessionParams", sessionID, (prev) => ({ ...prev, ...params }))
            saveParams()
          })
        },
        reset(sessionID: string | undefined) {
          if (!sessionID) return
          batch(() => {
            setParamStore("sessionParams", sessionID, {})
            saveParams()
          })
        },
        hasOverrides(sessionID: string | undefined): boolean {
          if (!sessionID) return false
          const params = paramStore.sessionParams[sessionID]
          if (!params) return false
          return Object.values(params).some((v) => v !== undefined)
        },
      }
    })

    // Watch for mode changes from hold_enter/hold_release tools
    // When the tool completes with modeChange metadata, sync.mode.pending() is set
    // This effect consumes the pending change and applies it to the UI mode
    createEffect(() => {
      const pending = sync.mode.pending()
      if (pending) {
        // Consume the pending change to clear the signal
        sync.mode.consume()
        // Apply the mode change
        if (pending === "hold") {
          mode.setHold()
          toast.show({
            variant: "info",
            message: "HOLD mode - Research only (from tool)",
            duration: 2000,
          })
        } else if (pending === "release") {
          mode.setRelease()
          toast.show({
            variant: "success",
            message: "RELEASE mode - Can edit files (from tool)",
            duration: 2000,
          })
        }
      }
    })

    const result = {
      model,
      agent,
      mcp,
      mode,
      parameters,
    }
    return result
  },
})
