import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "@tui/component/border"
import { Locale } from "@/util/locale"
import type { Session, AssistantMessage } from "@zee/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { useRoute } from "../../context/route"
import { useLocal } from "../../context/local"

export function Sidebar(props: { sessionID: string; overlay?: boolean; hideTitle?: boolean }) {
  const sync = useSync()
  const local = useLocal()
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
  const modelInfo = createMemo(() => {
    const { provider, model } = local.model.parsed()
    const variant = local.model.variant.current()
    return { provider, model, variant }
  })
  const contextUsage = createMemo(() => {
    const model = local.model.current()
    if (!model) return null
    const provider = sync.data.provider.find((p) => p.id === model.providerID)
    const modelInfo = provider?.models[model.modelID]
    if (!modelInfo?.limit?.context) return null

    const outputLimit = Math.min(modelInfo.limit.output ?? 8192, 16384)
    const usable = modelInfo.limit.input ?? (modelInfo.limit.context - outputLimit)
    if (usable <= 0) return null

    const messages = sync.data.message[props.sessionID] ?? []
    const lastAssistant = messages.findLast((m): m is typeof m & { role: "assistant" } => m.role === "assistant")
    if (!lastAssistant?.tokens) {
      return { count: 0, limit: usable, percent: 0 }
    }

    const count = lastAssistant.tokens.input + (lastAssistant.tokens.cache?.read ?? 0) + lastAssistant.tokens.output
    return { count, limit: usable, percent: Math.min(100, Math.round((count / usable) * 100)) }
  })
  const contextLimitLabel = createMemo(() => {
    const ctx = contextUsage()
    if (!ctx) return ""
    if (ctx.limit >= 1000000) return `${(ctx.limit / 1000000).toFixed(1)}M`
    if (ctx.limit >= 1000) return `${Math.round(ctx.limit / 1000)}k`
    return `${ctx.limit}`
  })
  const diffStats = createMemo(() => {
    const diffs = sync.data.session_diff[props.sessionID] ?? []
    if (diffs.length === 0) return null
    let additions = 0
    let deletions = 0
    let modified = 0
    for (const d of diffs) {
      additions += d.additions
      deletions += d.deletions
      if (d.additions > 0 && d.deletions > 0) modified++
    }
    return { files: diffs.length, additions, deletions, modified }
  })

  const directoryLabel = createMemo(() => {
    const path = sync.data.path?.directory
    if (!path) return ""
    return `~${path.replace(process.env.HOME ?? "", "")}`
  })
  const branchLabel = createMemo(() => sync.data.vcs?.branch)

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.background}
        width={40}
        height="100%"
        paddingTop={1}
        paddingBottom={0}
        paddingLeft={1}
        paddingRight={1}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox flexGrow={1}>
          <box flexShrink={0} gap={0} paddingRight={0}>
            <Show when={!props.hideTitle}>
              <box paddingRight={0} paddingBottom={1} gap={0}>
                <text fg={theme.text}>
                  <b>{session().title}</b>
                </text>
                <Show when={session().share?.url}>
                  <text fg={theme.textMuted}>{session().share!.url}</text>
                </Show>
                <Show when={contextUsage()}>
                  {(ctx) => (
                    <text
                      fg={ctx().percent >= 80 ? theme.error : ctx().percent >= 60 ? theme.warning : theme.textMuted}
                    >
                        {ctx().percent}% of {contextLimitLabel()}
                    </text>
                  )}
                </Show>

                <text fg={theme.text}>{modelInfo().provider}</text>
                <text fg={theme.text}>{modelInfo().model}</text>
                <Show when={modelInfo().variant}>
                  <text fg={theme.accent}>{modelInfo().variant}</text>
                </Show>
                <Show when={directoryLabel() || branchLabel()}>
                  <text fg={theme.text}>
                    <Show when={directoryLabel()}>{directoryLabel()}</Show>
                    <Show when={branchLabel()}>{` (${branchLabel()})`}</Show>
                  </text>
                </Show>
                <Show when={diffStats()}>
                  {(stats) => (
                    <box flexDirection="row">
                      <text fg={theme.textMuted}>{stats().files} file{stats().files !== 1 ? "s" : ""} changed </text>
                      <Show when={stats().additions > 0}>
                        <text fg={theme.success}>+{stats().additions}</text>
                      </Show>
                      <Show when={stats().additions > 0 && stats().modified > 0}>
                        <text> </text>
                      </Show>
                      <Show when={stats().modified > 0}>
                        <text fg={theme.warning}>~{stats().modified}</text>
                      </Show>
                      <Show when={(stats().additions > 0 || stats().modified > 0) && stats().deletions > 0}>
                        <text> </text>
                      </Show>
                      <Show when={stats().deletions > 0}>
                        <text fg={theme.error}>-{stats().deletions}</text>
                      </Show>
                    </box>
                  )}
                </Show>
              </box>
            </Show>
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
                              <Match when={item.status === "disabled"}>Unavailable (reconnect)</Match>
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
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>zee</b> <span>{runtimeLabel()}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
