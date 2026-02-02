import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { useTheme } from "../../context/theme"
import { useLocal } from "../../context/local"
import { Locale } from "@/util/locale"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { useRoute } from "../../context/route"
import type { ToolPart, ToolStateRunning } from "@agent-core/sdk/v2"
import { TextAttributes } from "@opentui/core"

type TabID = "activity" | "files" | "tasks" | "services"

// Truncate tool names to fit sidebar width (fallback for collision-prefixed names)
function shortToolName(name: string): string {
  return Locale.truncateMiddle(name, 22)
}

const TAB_CONFIG = {
  activity: { icon: "⊙", label: "Activity" },
  files: { icon: "◇", label: "Files" },
  tasks: { icon: "◻", label: "Tasks" },
  services: { icon: "◈", label: "Services" },
} as const

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const local = useLocal()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])

  // Context usage calculation (same as prompt)
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
    return {
      count,
      limit: usable,
      percent: Math.min(100, Math.round((count / usable) * 100)),
    }
  })

  // Model info for display
  const modelParsed = createMemo(() => local.model.parsed())

  const kv = useKV()
  const [activeTab, setActiveTab] = kv.signal<TabID>("sidebar_tab", "activity")

  // MCP servers sorted alphabetically
  const mcpEntries = createMemo(() =>
    Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b))
  )

  // Count connected and error MCP servers
  const connectedMcpCount = createMemo(
    () => mcpEntries().filter(([_, item]) => item.status === "connected").length
  )
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" ||
          item.status === "needs_auth" ||
          item.status === "needs_client_registration"
      ).length
  )

  // Get tool parts from current session messages for activity tab
  const toolParts = createMemo(() => {
    const messages = sync.data.message[props.sessionID] ?? []
    const parts: ToolPart[] = []
    for (const msg of messages) {
      const msgParts = sync.data.part[msg.id] ?? []
      for (const part of msgParts) {
        if (part.type === "tool") {
          parts.push(part as ToolPart)
        }
      }
    }
    return parts
  })

  // Currently running tools
  const runningTools = createMemo(() =>
    toolParts().filter((p) => p.state.status === "running")
  )

  // Recent completed/error tools (last 5)
  const recentTools = createMemo(() =>
    toolParts()
      .filter((p) => p.state.status === "completed" || p.state.status === "error")
      .slice(-5)
      .reverse()
  )

  // Tab counts
  const activityCount = createMemo(() => runningTools().length + recentTools().length)
  const filesCount = createMemo(() => diff().length)
  const tasksCount = createMemo(() => todo().filter((t) => t.status !== "completed").length)
  const servicesCount = createMemo(() => mcpEntries().length + sync.data.lsp.length)

  const tabCounts: Record<TabID, () => number> = {
    activity: activityCount,
    files: filesCount,
    tasks: tasksCount,
    services: servicesCount,
  }

  // Tabs with content
  const visibleTabs = createMemo(() => {
    const tabs: TabID[] = []
    if (activityCount() > 0) tabs.push("activity")
    if (filesCount() > 0) tabs.push("files")
    if (tasksCount() > 0) tabs.push("tasks")
    if (servicesCount() > 0) tabs.push("services")
    // Always show at least activity and services
    if (!tabs.includes("activity")) tabs.unshift("activity")
    if (!tabs.includes("services")) tabs.push("services")
    return tabs
  })

  const directory = useDirectory()
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
    sync.data.session
      .filter((s) => s.parentID === props.sessionID)
      .sort((a, b) => b.time.created - a.time.created)
  )

  const siblingsSessions = createMemo(() => {
    const parent = session()?.parentID
    if (!parent) return []
    return sync.data.session
      .filter((s) => s.parentID === parent && s.id !== props.sessionID)
      .sort((a, b) => b.time.created - a.time.created)
  })

  const hasBranches = createMemo(
    () => parentSession() !== null || childSessions().length > 0 || siblingsSessions().length > 0
  )

  // Format duration in human-readable format
  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m${remainingSeconds}s`
  }

  // Format elapsed time for running tools
  function formatElapsed(startTime: number): string {
    const elapsed = Date.now() - startTime
    return formatDuration(elapsed)
  }

  return (
    <Show when={session()}>
      <box
        width={50}
        height="100%"
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.backgroundPanel}
        position={props.overlay ? "absolute" : "relative"}
        border={["left"]}
        borderColor={theme.border}
      >
        <scrollbox flexGrow={1}>
          <box flexShrink={0} gap={0} paddingRight={0}>
            {/* Session title */}
            <box paddingRight={0} paddingBottom={1}>
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <Show when={session().share?.url}>
                <text fg={theme.textMuted}>{session().share!.url}</text>
              </Show>
            </box>

            {/* Context usage and model info - moved from prompt */}
            <box paddingBottom={1} gap={0}>
              <Show when={contextUsage()}>
                {(ctx) => (
                  <text
                    fg={ctx().percent >= 80 ? theme.error : ctx().percent >= 60 ? theme.warning : theme.textMuted}
                  >
                    Context: {ctx().percent}% of {ctx().limit >= 1000000 ? `${(ctx().limit / 1000000).toFixed(1)}M` : ctx().limit >= 1000 ? `${Math.round(ctx().limit / 1000)}k` : ctx().limit}
                  </text>
                )}
              </Show>
              <text fg={theme.textMuted}>
                Model: {modelParsed().provider}/{modelParsed().model}
              </text>
              <text fg={theme.textMuted}>
                {Locale.titlecase(local.agent.current().name)} · {sync.data.agent?.length ?? 0} skills
              </text>
            </box>

            {/* Tab bar */}
            <box flexDirection="row" gap={1} paddingBottom={1}>
              <For each={visibleTabs()}>
                {(tabId) => {
                  const config = TAB_CONFIG[tabId]
                  const count = tabCounts[tabId]()
                  const isActive = () => activeTab() === tabId
                  return (
                    <box
                      flexDirection="row"
                      gap={0}
                      onMouseDown={() => setActiveTab(() => tabId)}
                    >
                      <text
                        fg={isActive() ? theme.accent : theme.textMuted}
                        attributes={isActive() ? TextAttributes.BOLD : undefined}
                      >
                        {config.icon}
                        <Show when={count > 0}>
                          <span style={{ fg: isActive() ? theme.accent : theme.textMuted }}>
                            {count}
                          </span>
                        </Show>
                      </text>
                    </box>
                  )
                }}
              </For>
            </box>

            {/* Tab content */}
            <Switch>
              {/* Activity Tab */}
              <Match when={activeTab() === "activity"}>
                <box gap={0}>
                  <Show when={runningTools().length === 0 && recentTools().length === 0}>
                    <text fg={theme.textMuted}>No recent activity</text>
                  </Show>
                  <For each={runningTools()}>
                    {(tool) => {
                      const state = tool.state as ToolStateRunning
                      return (
                        <box flexDirection="row" gap={1}>
                          <text fg={theme.warning} flexShrink={0}>
                            ◐
                          </text>
                          <text fg={theme.text} wrapMode="none">
                            {shortToolName(tool.tool)}
                            <Show when={state.title}>
                              : <span style={{ fg: theme.textMuted }}>{Locale.truncateMiddle(state.title, 16)}</span>
                            </Show>
                            <span style={{ fg: theme.textMuted }}>
                              {" "}
                              ({formatElapsed(state.time.start)})
                            </span>
                          </text>
                        </box>
                      )
                    }}
                  </For>
                  <For each={recentTools()}>
                    {(tool) => {
                      const state = tool.state
                      const isError = state.status === "error"
                      const duration =
                        state.status === "completed" || state.status === "error"
                          ? formatDuration(state.time.end - state.time.start)
                          : ""
                      const title =
                        state.status === "completed"
                          ? state.title
                          : state.status === "error"
                            ? state.error
                            : ""
                      return (
                        <box flexDirection="row" gap={1}>
                          <text fg={isError ? theme.error : theme.success} flexShrink={0}>
                            {isError ? "✗" : "✓"}
                          </text>
                          <text fg={theme.text} wrapMode="none">
                            {shortToolName(tool.tool)}
                            <Show when={title}>
                              :{" "}
                              <span style={{ fg: theme.textMuted }}>
                                {Locale.truncateMiddle(title, 16)}
                              </span>
                            </Show>
                            <span style={{ fg: theme.textMuted }}> ({duration})</span>
                          </text>
                        </box>
                      )
                    }}
                  </For>
                </box>
              </Match>

              {/* Files Tab */}
              <Match when={activeTab() === "files"}>
                <box gap={0}>
                  <Show when={diff().length === 0}>
                    <text fg={theme.textMuted}>No file changes</text>
                  </Show>
                  <For each={diff()}>
                    {(item) => {
                      const statusIcon =
                        item.additions && item.deletions ? "M" : item.additions ? "A" : "D"
                      const statusColor =
                        item.additions && item.deletions
                          ? theme.warning
                          : item.additions
                            ? theme.success
                            : theme.error
                      return (
                        <box flexDirection="row" gap={1} justifyContent="space-between">
                          <box flexDirection="row" gap={0}>
                            <text fg={statusColor} flexShrink={0}>
                              {statusIcon}
                            </text>
                            <text fg={theme.textMuted}> </text>
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
                </box>
              </Match>

              {/* Tasks Tab */}
              <Match when={activeTab() === "tasks"}>
                <box gap={0}>
                  <Show when={todo().length === 0}>
                    <text fg={theme.textMuted}>No tasks</text>
                  </Show>
                  {/* Active tasks first */}
                  <For each={todo().filter((t) => t.status !== "completed")}>
                    {(item) => <TodoItem status={item.status} content={item.content} />}
                  </For>
                  {/* Completed tasks at bottom */}
                  <Show when={todo().some((t) => t.status === "completed")}>
                    <box paddingTop={1}>
                      <text fg={theme.textMuted}>Completed</text>
                      <For each={todo().filter((t) => t.status === "completed")}>
                        {(item) => <TodoItem status={item.status} content={item.content} />}
                      </For>
                    </box>
                  </Show>
                </box>
              </Match>

              {/* Services Tab */}
              <Match when={activeTab() === "services"}>
                <box gap={0}>
                  {/* MCP Servers */}
                  <Show when={mcpEntries().length > 0}>
                    <text fg={theme.text}>
                      <b>MCP</b>{" "}
                      <span style={{ fg: theme.textMuted }}>
                        ({connectedMcpCount()}
                        {errorMcpCount() > 0 ? ` / ${errorMcpCount()} err` : ""})
                      </span>
                    </text>
                    {/* Connected first */}
                    <For each={mcpEntries().filter(([_, item]) => item.status === "connected")}>
                      {([key, item]) => (
                        <box flexDirection="row" gap={1}>
                          <text fg={theme.success} flexShrink={0}>
                            •
                          </text>
                          <text fg={theme.text} wrapMode="none">
                            {key}
                          </text>
                        </box>
                      )}
                    </For>
                    {/* Errors */}
                    <For
                      each={mcpEntries().filter(
                        ([_, item]) =>
                          item.status === "failed" ||
                          item.status === "needs_auth" ||
                          item.status === "needs_client_registration"
                      )}
                    >
                      {([key, item]) => (
                        <box flexDirection="row" gap={1}>
                          <text
                            fg={
                              item.status === "needs_auth"
                                ? theme.warning
                                : theme.error
                            }
                            flexShrink={0}
                          >
                            •
                          </text>
                          <text fg={theme.textMuted} wrapMode="none">
                            {key}
                            <Switch>
                              <Match when={item.status === "needs_auth"}> (auth)</Match>
                              <Match when={item.status === "needs_client_registration"}>
                                {" "}
                                (client ID)
                              </Match>
                              <Match when={item.status === "failed" && item}>
                                {(val) => <i> {val().error}</i>}
                              </Match>
                            </Switch>
                          </text>
                        </box>
                      )}
                    </For>
                    {/* Disabled */}
                    <For each={mcpEntries().filter(([_, item]) => item.status === "disabled")}>
                      {([key]) => (
                        <box flexDirection="row" gap={1}>
                          <text fg={theme.textMuted} flexShrink={0}>
                            •
                          </text>
                          <text fg={theme.textMuted} wrapMode="none">
                            {key} (disabled)
                          </text>
                        </box>
                      )}
                    </For>
                  </Show>

                  {/* LSP Servers */}
                  <box paddingTop={mcpEntries().length > 0 ? 1 : 0}>
                    <text fg={theme.text}>
                      <b>LSP</b>
                    </text>
                    <Show
                      when={sync.data.lsp.length > 0}
                      fallback={
                        <text fg={theme.textMuted}>
                          {sync.data.config.lsp === false
                            ? "Disabled"
                            : "Will activate on file read"}
                        </text>
                      }
                    >
                      <For each={sync.data.lsp}>
                        {(item) => (
                          <box flexDirection="row" gap={1}>
                            <text
                              flexShrink={0}
                              fg={item.status === "connected" ? theme.success : theme.error}
                            >
                              •
                            </text>
                            <text fg={theme.textMuted} wrapMode="none">
                              {item.id}
                            </text>
                          </box>
                        )}
                      </For>
                    </Show>
                  </box>
                </box>
              </Match>
            </Switch>

            {/* Branch tree */}
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
                    <text fg={theme.accent}>
                      {Locale.truncateMiddle(parentSession()!.title ?? "Parent", 32)}
                    </text>
                  </box>
                  <box flexDirection="row" gap={0}>
                    <text fg={theme.textMuted}>┊</text>
                  </box>
                </Show>
                <For each={siblingsSessions()}>
                  {(sibling) => (
                    <box
                      flexDirection="row"
                      gap={0}
                      onMouseDown={() => navigate({ type: "session", sessionID: sibling.id })}
                    >
                      <text fg={theme.textMuted}>├─○ </text>
                      <text fg={theme.textMuted}>
                        {Locale.truncateMiddle(sibling.title ?? "Branch", 30)}
                      </text>
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
                      <text fg={theme.textMuted}>
                        {idx() === childSessions().length - 1 ? "└─○ " : "├─○ "}
                      </text>
                      <text fg={theme.accent}>
                        {Locale.truncateMiddle(child.title ?? "Child", 30)}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </box>
        </scrollbox>

        {/* Footer */}
        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <box
              border={["top"]}
              borderColor={theme.border}
              paddingTop={1}
              paddingBottom={1}
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
                <text fg={theme.textMuted}>
                  Connect a provider to use Claude, GPT, Gemini, and 75+ other models.
                </text>
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
