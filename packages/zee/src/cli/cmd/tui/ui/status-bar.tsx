import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useRoute } from "../context/route"
import { useDirectory } from "../context/directory"
import { useConnected } from "../component/dialog-model"
import { StatusBar as StatusBarStyle } from "../../../style"
import type { AssistantMessage } from "@zee/sdk/v2"

export function StatusBar() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const local = useLocal()
  const directory = useDirectory()
  const connected = useConnected()

  const mcpStatuses = createMemo(() => Object.values(sync.data.mcp))
  const mcpTotal = createMemo(() => mcpStatuses().length)
  const mcpConnected = createMemo(() => mcpStatuses().filter((x) => x.status === "connected").length)
  const mcpDegraded = createMemo(() =>
    mcpStatuses().filter(
      (x) =>
        x.status === "failed" || x.status === "needs_auth" || x.status === "needs_client_registration",
    ).length,
  )
  const mcpLoading = createMemo(() => sync.data.mcp_meta.loading)
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const internet = createMemo(() => sync.data.health.internet)
  const connectedProviders = createMemo(() => sync.data.health.providers.filter((p) => p.status === "ok").length)
  const memoryStatus = createMemo(() => sync.data.health.memory?.status)

  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })

  const sessionCostLabel = createMemo(() => {
    if (route.data.type !== "session") return ""
    const msgs = sync.data.message[route.data.sessionID] ?? []
    let total = 0
    for (const msg of msgs) {
      if (msg.role === "assistant") {
        total += (msg as AssistantMessage).cost ?? 0
      }
    }
    if (total === 0) return ""
    if (total < 0.01) return `$${total.toFixed(4)}`
    if (total < 1) return `$${total.toFixed(3)}`
    return `$${total.toFixed(2)}`
  })

  const streamHealth = createMemo(() => {
    if (route.data.type !== "session") return undefined
    const status = sync.data.session_status?.[route.data.sessionID]
    if (!status || status.type !== "busy") return undefined
    return status.streamHealth
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
            <text fg={local.mode.isPlan() ? theme.warning : local.mode.isBypass() ? theme.error : theme.success}>
              {local.mode.isPlan() ? "◼ PLAN" : local.mode.isBypass() ? "◻ BYPASS" : "◻ ACCEPT"}
            </text>
            <text fg={theme.border}>{StatusBarStyle.separator}</text>
            <Show when={sessionCostLabel()}>
              <text fg={theme.textMuted}>{sessionCostLabel()}</text>
              <text fg={theme.border}>{StatusBarStyle.separator}</text>
            </Show>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                ⚠{permissions().length}
              </text>
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

                if (health.isThinking) {
                  const thinkingSeconds = Math.round((health.timeSinceContentMs ?? 0) / 1000)
                  return (
                    <>
                      <text fg={theme.warning}>◐ thinking {thinkingSeconds}s</text>
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
                      <text fg={theme.warning}>◐ waiting {elapsedSeconds}s</text>
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
              <Show when={memoryStatus() === "fail"}>
                <text fg={theme.border}>{StatusBarStyle.innerSeparator}</text>
                <text fg={theme.error}>MEM</text>
              </Show>
              <text fg={theme.border}>{StatusBarStyle.innerSeparator}</text>
              <text fg={lsp().length > 0 ? theme.success : theme.textMuted}>●{lsp().length}</text>
              <text fg={theme.border}>{StatusBarStyle.innerSeparator}</text>
              <Switch>
                <Match when={mcpTotal() === 0 && mcpLoading()}>
                  <text fg={theme.textMuted}>⊙…</text>
                </Match>
                <Match when={mcpTotal() === 0}>
                  <text fg={theme.textMuted}>⊙?</text>
                </Match>
                <Match when={mcpDegraded() > 0}>
                  <text fg={theme.error}>⊘{mcpConnected()}/{mcpTotal()}</text>
                </Match>
                <Match when={mcpConnected() < mcpTotal()}>
                  <text fg={theme.warning}>◐{mcpConnected()}/{mcpTotal()}</text>
                </Match>
                <Match when={true}>
                  <text fg={theme.success}>⊙{mcpConnected()}/{mcpTotal()}</text>
                </Match>
              </Switch>
            </box>
            <text fg={theme.border}>{StatusBarStyle.separator}</text>
            <text fg={theme.textMuted}>:help</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
