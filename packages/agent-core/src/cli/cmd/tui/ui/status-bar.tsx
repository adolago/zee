import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useRoute } from "../context/route"
import { useDirectory } from "../context/directory"
import { useConnected } from "../component/dialog-model"
import { StatusBar as StatusBarStyle } from "../../../style"

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
