import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useRoute } from "../context/route"
import { useDirectory } from "../context/directory"
import { useConnected } from "../component/dialog-model"
import { StatusBar as StatusBarStyle } from "../../../style"
import type { ToolPart } from "@agent-core/sdk/v2"

export function StatusBar() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const local = useLocal()
  const directory = useDirectory()
  const connected = useConnected()

  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const internet = createMemo(() => sync.data.health.internet)
  const connectedProviders = createMemo(() => sync.data.health.providers.filter((p) => p.status === "ok").length)

  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })

  const streamHealth = createMemo(() => {
    if (route.data.type !== "session") return undefined
    const status = sync.data.session_status?.[route.data.sessionID]
    if (!status || status.type !== "busy") return undefined
    return status.streamHealth
  })

  // Current activity state for better status indication
  const currentActivity = createMemo(() => {
    if (route.data.type !== "session") return { state: "idle" as const, toolCount: 0, currentTool: undefined as string | undefined }
    
    const sessionID = route.data.sessionID
    const messages = sync.data.message[sessionID] ?? []
    const pendingMsg = messages.findLast((x) => x.role === "assistant" && !x.time.completed)
    
    if (!pendingMsg) return { state: "idle" as const, toolCount: 0, currentTool: undefined }
    
    const parts = sync.data.part[pendingMsg.id] ?? []
    const toolParts = parts.filter((p): p is ToolPart => p.type === "tool")
    const runningTools = toolParts.filter((p) => p.state.status === "running" || p.state.status === "pending")
    const completedTools = toolParts.filter((p) => p.state.status === "completed")
    
    if (runningTools.length > 0) {
      return { 
        state: "running" as const, 
        toolCount: toolParts.length,
        completedCount: completedTools.length,
        currentTool: runningTools[0].tool 
      }
    }
    
    return { state: "thinking" as const, toolCount: toolParts.length, currentTool: undefined }
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  // onMount(() => {
  //   const timeouts: ReturnType<typeof setTimeout>[] = []

  //   function tick() {
  //     if (connected()) return
  //     if (!store.welcome) {
  //       setStore("welcome", true)
  //       timeouts.push(setTimeout(() => tick(), 5000))
  //       return
  //     }

  //     if (store.welcome) {
  //       setStore("welcome", false)
  //       timeouts.push(setTimeout(() => tick(), 10_000))
  //       return
  //     }
  //   }
  //   timeouts.push(setTimeout(() => tick(), 10_000))

  //   onCleanup(() => {
  //     timeouts.forEach(clearTimeout)
  //   })
  // })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={0} flexShrink={0}>
      <text fg={theme.textMuted} flexShrink={1}>
        {directory()}
      </text>
      <box gap={0} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>:connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            {/* Mode indicator */}
            <text fg={local.mode.isHold() ? theme.warning : theme.success}>
              {local.mode.isHold() ? "◼ HOLD" : "◻ RELEASE"}
            </text>
            <text fg={theme.border}>{StatusBarStyle.separator}</text>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                ⚠{permissions().length}
              </text>
              <text fg={theme.border}>{StatusBarStyle.separator}</text>
            </Show>
            {/* Activity indicator - clearer state visualization */}
            <Show when={currentActivity().state !== "idle"}>
              <Switch>
                <Match when={currentActivity().state === "running"}>
                  <text fg={theme.accent}>
                    ◐ {currentActivity().currentTool}
                    <Show when={currentActivity().toolCount > 1}>
                      <span style={{ fg: theme.textMuted }}>
                        {" "}({(currentActivity() as any).completedCount ?? 0}/{currentActivity().toolCount})
                      </span>
                    </Show>
                  </text>
                </Match>
                <Match when={currentActivity().state === "thinking"}>
                  <text fg={theme.warning}>◐ thinking</text>
                </Match>
              </Switch>
              <text fg={theme.border}>{StatusBarStyle.separator}</text>
            </Show>
            <Show when={streamHealth()}>
              {(() => {
                const health = streamHealth()!
                const elapsed = health.timeSinceLastEventMs ?? 0
                const elapsedSeconds = Math.round(elapsed / 1000)

                if (health.isStalled) {
                  return (
                    <>
                      <text fg={theme.error}>⊘ stalled {elapsedSeconds}s</text>
                      <text fg={theme.border}>{StatusBarStyle.separator}</text>
                    </>
                  )
                }

                if (elapsed >= 45_000) {
                  return (
                    <>
                      <text fg={theme.error}>⚠ delayed {elapsedSeconds}s</text>
                      <text fg={theme.border}>{StatusBarStyle.separator}</text>
                    </>
                  )
                }

                if (elapsed >= 30_000) {
                  return (
                    <>
                      <text fg={theme.warning}>⚠ slow {elapsedSeconds}s</text>
                      <text fg={theme.border}>{StatusBarStyle.separator}</text>
                    </>
                  )
                }

                return null
              })()}
            </Show>
            {/* Network & Providers & LSP & MCP Group */}
            <box flexDirection="row" gap={0}>
              <Switch>
                <Match when={internet() === "ok"}>
                  <text fg={theme.success}>◉</text>
                </Match>
                <Match when={internet() === "fail"}>
                  <text fg={theme.error}>◉</text>
                </Match>
                <Match when={internet() === "checking"}>
                  <text fg={theme.textMuted}>◉</text>
                </Match>
              </Switch>
              <Show when={connectedProviders() > 0}>
                <text fg={theme.border}>{StatusBarStyle.innerSeparator}</text>
                <text fg={theme.success}>◈{connectedProviders()}</text>
              </Show>
              <text fg={theme.border}>{StatusBarStyle.innerSeparator}</text>
              <text fg={lsp().length > 0 ? theme.success : theme.textMuted}>●{lsp().length}</text>
              <Show when={mcp() > 0}>
                <text fg={theme.border}>{StatusBarStyle.innerSeparator}</text>
                <Switch>
                  <Match when={mcpError()}>
                    <text fg={theme.error}>⊘{mcp()}</text>
                  </Match>
                  <Match when={true}>
                    <text fg={theme.success}>⊙{mcp()}</text>
                  </Match>
                </Switch>
              </Show>
            </box>
            <text fg={theme.border}>{StatusBarStyle.separator}</text>
            <text fg={theme.textMuted}>:help</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
