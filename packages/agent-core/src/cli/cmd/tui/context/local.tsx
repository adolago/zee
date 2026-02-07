import { createStore, produce, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo, createSignal } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme, resolveTheme } from "@tui/context/theme"
import { uniqueBy } from "remeda"
import path from "path"
import { Global } from "@/global"
import { iife } from "@/util/iife"
import { Binary } from "@agent-core/util/binary"
import { createSimpleContext } from "./helper"
import { useToast } from "../ui/toast"
import { Provider } from "@/provider/provider"
import { Locale } from "@/util/locale"
import { useArgs } from "./args"
import { useSDK } from "./sdk"
import { RGBA } from "@opentui/core"
import type { Agent as SDKAgent } from "@agent-core/sdk/v2"
import { personaPalettes, type PersonaId } from "@root/theme/rosetta"

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
      const colors = createMemo((): RGBA[] => [
        theme.secondary,
        theme.accent,
        theme.success,
        theme.warning,
        theme.primary,
        theme.error,
        theme.info,
      ])

      const visibleAgents = createMemo(() => {
        const all = sync.data?.agent
        if (!all || !Array.isArray(all)) return []
        return all.filter((x) => !x.hidden)
      })

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
        color(name: string): RGBA {
          const all = sync.data?.agent
          if (!all || !Array.isArray(all)) return colors()[0]!
          const agent = all.find((x) => x.name.toLowerCase() === name.toLowerCase())

          // First check for agent's custom color property
          if (agent?.color) {
            if (agent.color.startsWith("#")) return RGBA.fromHex(agent.color)
            // Theme color name (primary, secondary, accent, success, warning, error, info)
            const themeColorMap: Record<string, RGBA> = {
              primary: theme.primary,
              secondary: theme.secondary,
              accent: theme.accent,
              success: theme.success,
              warning: theme.warning,
              error: theme.error,
              info: theme.info,
            }
            const themeColor = themeColorMap[agent.color]
            if (themeColor) return themeColor
          }

          // Check if this is a persona and use their theme's accent color
          const personaColor = getPersonaAccentColor(name)
          if (personaColor) return personaColor

          // Rosetta Stone fallback for known personas
          const rosetta = personaPalettes[name.toLowerCase() as PersonaId]
          if (rosetta) return RGBA.fromHex(rosetta.accent.hex)

          // Fall back to indexed colors for other agents
          const visible = visibleAgents()
          const index = visible.findIndex((x) => x.name.toLowerCase() === name.toLowerCase())
          if (index === -1) return colors()[0]!
          return colors()[index % colors().length]!
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
        ).catch(() => {
          toast.show({
            variant: "warning",
            message: "Failed to save model preferences",
          })
        })
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
        isFavorite(model?: { providerID: string; modelID: string }) {
          if (!model) return false
          return modelStore.favorite.some(
            (f) => f.providerID === model.providerID && f.modelID === model.modelID,
          )
        },
        toggleFavorite(model?: { providerID: string; modelID: string }) {
          if (!model) return
          const idx = modelStore.favorite.findIndex(
            (f) => f.providerID === model.providerID && f.modelID === model.modelID,
          )
          if (idx >= 0) {
            setModelStore("favorite", (arr) => arr.filter((_, i) => i !== idx))
          } else {
            setModelStore("favorite", (arr) => [...arr, { providerID: model.providerID, modelID: model.modelID }])
          }
          save()
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = modelStore.favorite.filter(isModelValid)
          if (favorites.length === 0) return false
          const current = currentModel()
          if (!current) {
            const target = favorites[0]
            if (target) setModelStore("sessionModel", agent.current().name, target)
            return true
          }
          const idx = favorites.findIndex(
            (f) => f.providerID === current.providerID && f.modelID === current.modelID,
          )
          let next = idx + direction
          if (next < 0) next = favorites.length - 1
          if (next >= favorites.length) next = 0
          const target = favorites[next]
          if (target) setModelStore("sessionModel", agent.current().name, target)
          save()
          return true
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
        async setDefault(model: { providerID: string; modelID: string }) {
          if (!isModelValid(model)) {
            toast.show({
              message: `Model ${model.providerID}/${model.modelID} is not valid`,
              variant: "warning",
              duration: 3000,
            })
            return
          }

          const currentAgent = agent.current()
          const agentName = currentAgent?.name
          if (!agentName) {
            toast.show({
              message: "No active agent to set default model",
              variant: "warning",
              duration: 3000,
            })
            return
          }

          const agentKey = agentName.toLowerCase()
          const previous = currentModel()
          // Optimistic update to keep UI responsive
          setModelStore("sessionModel", agentName, model)

          try {
            const modelRef = `${model.providerID}/${model.modelID}`
            const updated = await sdk.client.config.update({
              config: {
                agent: {
                  [agentKey]: {
                    model: modelRef,
                  },
                },
              },
            })
            if (updated.data) {
              sync.set("config", reconcile(updated.data))
            }
            sync.set(
              produce((draft) => {
                const match = draft.agent.find((x) => x.name.toLowerCase() === agentKey)
                if (match) {
                  match.model = model
                }
              }),
            )
            // Clear session override so defaults stay in sync with messaging
            setModelStore("sessionModel", (current) => {
              const next = { ...current }
              delete next[agentName]
              return next
            })
            toast.show({
              message: `Default model set for ${Locale.titlecase(agentName)}`,
              variant: "success",
              duration: 2000,
            })
          } catch (error) {
            // Revert on failure
            if (previous) {
              setModelStore("sessionModel", agentName, previous)
            } else {
              setModelStore("sessionModel", (current) => {
                const next = { ...current }
                delete next[agentName]
                return next
              })
            }
            toast.show({
              message: "Failed to update default model",
              variant: "error",
              duration: 3000,
            })
          }
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
      const [activeSessionID, setActiveSessionID] = createSignal<string | null>(null)
      let inflightSync: Promise<void> | null = null

      function resolveHoldFromSession(session: { mode?: "hold" | "release"; surface?: string }): boolean {
        // Per-session mode
        if (session.mode === "hold") return true
        if (session.mode === "release") return false
        // Surface defaults: messaging surfaces default to release
        if (session.surface === "whatsapp" || session.surface === "matrix") return false
        return true // TUI default to hold
      }

      async function ensureSessionLoaded(sessionID: string, options?: { force?: boolean }): Promise<void> {
        if (!options?.force) {
          const existing = sync.session.get(sessionID) as
            | (ReturnType<typeof sync.session.get> & { mode?: "hold" | "release"; surface?: string })
            | undefined
          if (existing) return
        }
        try {
          const res = await sdk.client.session.get({ sessionID })
          if (!res.data) return
          sync.set(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session[match.index] = res.data
              if (!match.found) draft.session.splice(match.index, 0, res.data)
            }),
          )
        } catch {
          // Best-effort; UI will fall back to hold until the session is available.
        }
      }

      function resolveHold(): boolean {
        const sessionID = activeSessionID()
        if (!sessionID) return true // Default to hold when no session
        const session = sync.session.get(sessionID) as
          | (ReturnType<typeof sync.session.get> & { mode?: "hold" | "release"; surface?: string })
          | undefined
        if (!session) {
          if (!inflightSync) {
            inflightSync = ensureSessionLoaded(sessionID).finally(() => {
              inflightSync = null
            })
          }
          return true
        }
        return resolveHoldFromSession(session)
      }

      async function setSessionMode(next: "hold" | "release") {
        const sessionID = activeSessionID()
        if (!sessionID) return false

        // Ensure we have a session record so UI indicators can update immediately.
        await ensureSessionLoaded(sessionID)
        try {
          await sdk.client.session.mode({ sessionID, mode: next }, { throwOnError: true })
          sync.set(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (!match.found) return
              draft.session[match.index].mode = next
            }),
          )
          // Best-effort refresh to pick up updated timestamps and any server-side changes.
          void ensureSessionLoaded(sessionID, { force: true })
          return true
        } catch (e) {
          toast.show({
            variant: "error",
            message: `Failed to switch to ${next.toUpperCase()} mode`,
            duration: 3000,
          })
          return false
        }
      }

      return {
        setSession(sessionID: string | null) {
          setActiveSessionID(sessionID)
          if (sessionID) {
            if (!inflightSync) {
              inflightSync = ensureSessionLoaded(sessionID).finally(() => {
                inflightSync = null
              })
            }
          }
        },
        isHold() {
          return resolveHold()
        },
        isRelease() {
          return !resolveHold()
        },
        toggle() {
          void (async () => {
            const sessionID = activeSessionID()
            if (!sessionID) return
            await ensureSessionLoaded(sessionID)
            const newMode = resolveHold() ? "release" : "hold"
            const ok = await setSessionMode(newMode)
            if (!ok) return
            toast.show({
              variant: newMode === "hold" ? "info" : "success",
              message: newMode === "hold" ? "HOLD mode - Research only" : "RELEASE mode - Can edit files",
              duration: 2000,
            })
          })()
        },
        setHold() {
          void (async () => {
            const sessionID = activeSessionID()
            if (!sessionID) return
            await ensureSessionLoaded(sessionID)
            if (resolveHold()) return
            await setSessionMode("hold")
          })()
        },
        setRelease() {
          void (async () => {
            const sessionID = activeSessionID()
            if (!sessionID) return
            await ensureSessionLoaded(sessionID)
            if (!resolveHold()) return
            await setSessionMode("release")
          })()
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
        Bun.write(paramsFile, JSON.stringify(paramStore.sessionParams)).catch(
          () => {
            toast.show({
              variant: "warning",
              message: "Failed to save session parameters",
            })
          },
        )
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
