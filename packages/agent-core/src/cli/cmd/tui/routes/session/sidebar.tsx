import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "@tui/component/border"
import { Locale } from "@/util/locale"
import type { Session } from "@opencode-ai/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { useRoute } from "../../context/route"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
  })

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )


  const directory = useDirectory()
  const kv = useKV()

  const hasProviders = createMemo(() => sync.data.provider.length > 0)
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))
  const runtimeLabel = createMemo(() => {
    const runtime = Installation.runtimeInfo()
    return `${runtime.version} (${runtime.channel}/${runtime.mode})`
  })

  const { navigate } = useRoute()

  // Branch tree data
  const parentSession = createMemo(() => {
    const parent = session()?.parentID
    if (!parent) return null
    return sync.data.session.find((s) => s.id === parent) ?? null
  })

  const childSessions = createMemo(() =>
    sync.data.session.filter((s) => s.parentID === props.sessionID).sort((a, b) => b.time.created - a.time.created),
  )

  const siblingsSessions = createMemo(() => {
    const parent = session()?.parentID
    if (!parent) return []
    return sync.data.session
      .filter((s) => s.parentID === parent && s.id !== props.sessionID)
      .sort((a, b) => b.time.created - a.time.created)
  })

  const hasBranches = createMemo(
    () => parentSession() !== null || childSessions().length > 0 || siblingsSessions().length > 0,
  )

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={40}
        height="100%"
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={1}
        paddingRight={1}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox flexGrow={1}>
          <box flexShrink={0} gap={0} paddingRight={0}>
            <box paddingRight={0} paddingBottom={1}>
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <Show when={session().share?.url}>
                <text fg={theme.textMuted}>{session().share!.url}</text>
              </Show>
            </box>
            <Show when={mcpEntries().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                >
                  <Show when={mcpEntries().length > 2}>
                    <text fg={theme.text}>{expanded.mcp ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>MCP</b>
                    <Show when={!expanded.mcp}>
                      <span style={{ fg: theme.textMuted }}>
                        {" "}
                        ({connectedMcpCount()} active
                        {errorMcpCount() > 0 ? `, ${errorMcpCount()} error${errorMcpCount() > 1 ? "s" : ""}` : ""})
                      </span>
                    </Show>
                  </text>
                </box>
                <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                  <For each={mcpEntries()}>
                    {([key, item]) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: (
                              {
                                connected: theme.success,
                                failed: theme.error,
                                disabled: theme.textMuted,
                                needs_auth: theme.warning,
                                needs_client_registration: theme.error,
                              } as Record<string, typeof theme.success>
                            )[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {key}{" "}
                          <span style={{ fg: theme.textMuted }}>
                            <Switch fallback={item.status}>
                              <Match when={item.status === "connected"}>Connected</Match>
                              <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                              <Match when={item.status === "disabled"}>Disabled</Match>
                              <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
                              <Match when={(item.status as string) === "needs_client_registration"}>
                                Needs client ID
                              </Match>
                            </Switch>
                          </span>
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
              >
                <Show when={sync.data.lsp.length > 2}>
                  <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>LSP</b>
                </text>
              </box>
              <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                <Show when={sync.data.lsp.length === 0}>
                  <text fg={theme.textMuted}>
                    {sync.data.config.lsp === false
                      ? "LSPs have been disabled in settings"
                      : "LSPs will activate as files are read"}
                  </text>
                </Show>
                <For each={sync.data.lsp}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            error: theme.error,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text fg={theme.textMuted}>
                        {item.id} {item.root}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <Show when={todo().length > 2}>
                    <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Todo</b>
                  </text>
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                </Show>
              </box>
            </Show>
            <Show when={diff().length > 0}>
              <box paddingTop={1}>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                >
                  <Show when={diff().length > 2}>
                    <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Files</b>
                  </text>
                </box>
                <Show when={diff().length <= 2 || expanded.diff}>
                  <For each={diff() || []}>
                    {(item) => {
                      const statusIcon = item.additions && item.deletions ? "M" : item.additions ? "A" : "D"
                      const statusColor = item.additions && item.deletions ? theme.warning : item.additions ? theme.success : theme.error
                      return (
                        <box flexDirection="row" gap={0} justifyContent="space-between">
                          <box flexDirection="row" gap={0}>
                            <text fg={theme.textMuted}>┊</text>
                            <text fg={statusColor}>{statusIcon}</text>
                            <text fg={theme.textMuted}>┊</text>
                            <text fg={theme.text} wrapMode="none">
                              {item.file.split("/").pop()}
                            </text>
                          </box>
                          <box flexDirection="row" gap={0} flexShrink={0}>
                            <Show when={item.additions}>
                              <text fg={theme.diffAdded}>+{item.additions}</text>
                            </Show>
                            <Show when={item.deletions}>
                              <text fg={theme.diffRemoved}>-{item.deletions}</text>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={hasBranches()}>
              <box paddingTop={1}>
                <text fg={theme.text}>
                  <b>Tree</b>
                </text>
                <Show when={parentSession()}>
                  <box
                    flexDirection="row"
                    gap={0}
                    onMouseDown={() => navigate({ type: "session", sessionID: parentSession()!.id })}
                  >
                    <text fg={theme.textMuted}>┊</text>
                    <text fg={theme.accent}>{Locale.truncateMiddle(parentSession()!.title ?? "Parent", 32)}</text>
                  </box>
                  <box flexDirection="row" gap={0}>
                    <text fg={theme.textMuted}>┊</text>
                  </box>
                </Show>
                <For each={siblingsSessions()}>
                  {(sibling, idx) => (
                    <box
                      flexDirection="row"
                      gap={0}
                      onMouseDown={() => navigate({ type: "session", sessionID: sibling.id })}
                    >
                      <text fg={theme.textMuted}>├─○ </text>
                      <text fg={theme.textMuted}>{Locale.truncateMiddle(sibling.title ?? "Branch", 30)}</text>
                    </box>
                  )}
                </For>
                <box flexDirection="row" gap={0}>
                  <text fg={theme.textMuted}>├─</text>
                  <text fg={theme.primary}>◉</text>
                  <text fg={theme.text}>
                    <b>{Locale.truncateMiddle(session()?.title ?? "Current", 28)}</b>
                  </text>
                </box>
                <For each={childSessions()}>
                  {(child, idx) => (
                    <box
                      flexDirection="row"
                      gap={0}
                      onMouseDown={() => navigate({ type: "session", sessionID: child.id })}
                    >
                      <text fg={theme.textMuted}>{idx() === childSessions().length - 1 ? "└─○ " : "├─○ "}</text>
                      <text fg={theme.accent}>{Locale.truncateMiddle(child.title ?? "Child", 30)}</text>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0} fg={theme.text}>
                ⬖
              </text>
              <box flexGrow={1} gap={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text}>
                    <b>Getting started</b>
                  </text>
                  <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                    ✕
                  </text>
                </box>
                <text fg={theme.textMuted}>Connect a provider to use Claude, GPT, Gemini, and 75+ other models.</text>
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text fg={theme.text}>Connect provider</text>
                  <text fg={theme.textMuted}>:connect</text>
                </box>
              </box>
            </box>
          </Show>
          <text>
            <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
            <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
          </text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>agent</b>
            <span style={{ fg: theme.text }}>
              <b>-core</b>
            </span>{" "}
            <span>{runtimeLabel()}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
