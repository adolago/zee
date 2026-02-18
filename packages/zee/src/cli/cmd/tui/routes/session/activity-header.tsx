import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import type { ToolPart, Part } from "@zee/sdk/v2"
import { useAnimationTick } from "@tui/util/animation-tick"
import { stackedTildeFrame } from "@tui/ui/tilde-spinner"

type ActivityState = "idle" | "thinking" | "running" | "completed"

interface ActivityInfo {
  state: ActivityState
  description: string
  toolSummary?: string
  elapsedMs?: number
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function getToolSummary(part: ToolPart): string {
  const input = part.state.input ?? {}
  switch (part.tool) {
    case "grep":
      return `Searching: '${input.pattern ?? ""}' in ${input.path ?? "."}`
    case "read":
      return `Reading: ${input.filePath ?? ""}`
    case "write":
      return `Writing: ${input.filePath ?? ""}`
    case "edit":
      return `Editing: ${input.filePath ?? ""}`
    case "bash":
      return `Running: ${(input.command as string)?.slice(0, 50) ?? ""}...`
    case "glob":
      return `Finding: ${input.pattern ?? "*"}`
    case "list":
      return `Listing: ${input.path ?? "."}`
    case "webfetch":
      return `Fetching: ${input.url ?? ""}`
    case "websearch":
      return `Searching web...`
    case "codesearch":
      return `Searching code...`
    case "apply_patch":
      return `Applying patch...`
    case "task":
      return `Managing tasks...`
    case "todowrite":
      return `Updating todos...`
    case "skill":
      return `Loading skill: ${input.name ?? ""}`
    default:
      return `${part.tool}...`
  }
}

export function ActivityHeader(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()

  const [now, setNow] = createSignal(Date.now())
  const interval = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(interval))

  const tick = useAnimationTick()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const sessionStatus = createMemo(() => sync.data.session_status?.[props.sessionID])

  const pendingMessage = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)
  })

  const lastCompletedMessage = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && x.time.completed)
  })

  const currentToolParts = createMemo((): ToolPart[] => {
    const pending = pendingMessage()
    if (!pending) return []
    const parts = sync.data.part[pending.id] ?? []
    return parts.filter((p): p is ToolPart => p.type === "tool")
  })

  const runningTools = createMemo(() => {
    return currentToolParts().filter(
      (p) => p.state.status === "pending" || p.state.status === "running"
    )
  })

  const lastCompletedTool = createMemo((): ToolPart | undefined => {
    const tools = currentToolParts().filter((p) => p.state.status === "completed")
    return tools[tools.length - 1]
  })

  const lastEverCompletedTool = createMemo((): ToolPart | undefined => {
    const lastMsg = lastCompletedMessage()
    if (!lastMsg) return undefined
    const parts = sync.data.part[lastMsg.id] ?? []
    const tools = parts.filter(
      (p): p is ToolPart => p.type === "tool" && p.state.status === "completed"
    )
    return tools[tools.length - 1]
  })

  const activity = createMemo((): ActivityInfo => {
    const status = sessionStatus()
    const pending = pendingMessage()
    const running = runningTools()

    if (!pending) {
      const lastTool = lastEverCompletedTool()
      return {
        state: "idle",
        description: "Waiting for input",
        toolSummary: lastTool ? `Last: ${getToolSummary(lastTool)}` : undefined,
      }
    }

    if (running.length > 0) {
      const firstRunning = running[0]
      const startTime =
        firstRunning.state.status === "running" ? firstRunning.state.time?.start : undefined
      return {
        state: "running",
        description: `Running ${running.length} tool${running.length > 1 ? "s" : ""}...`,
        toolSummary: getToolSummary(firstRunning),
        elapsedMs: startTime ? now() - startTime : undefined,
      }
    }

    const phase = status?.type === "busy" ? status.streamHealth?.phase : undefined
    if (phase === "tool_calling") {
      return {
        state: "running",
        description: "Preparing tool call...",
        toolSummary: lastCompletedTool()
          ? `Last: ${getToolSummary(lastCompletedTool()!)}`
          : undefined,
        elapsedMs: pending.time.created ? now() - pending.time.created : undefined,
      }
    }

    return {
      state: "thinking",
      description: "Thinking...",
      toolSummary: lastCompletedTool()
        ? `Last: ${getToolSummary(lastCompletedTool()!)}`
        : undefined,
      elapsedMs: pending.time.created ? now() - pending.time.created : undefined,
    }
  })

  const isActive = createMemo(() => activity().state !== "idle")

  const stateColor = createMemo(() => {
    switch (activity().state) {
      case "thinking":
        return theme.accent
      case "running":
        return theme.warning
      case "completed":
        return theme.success
      default:
        return theme.textMuted
    }
  })

  const spinnerChar = createMemo(() => stackedTildeFrame(tick()))

  return (
    <box
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.backgroundPanel}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" gap={1}>
        <Show when={isActive()} fallback={<text fg={theme.textMuted}>·</text>}>
          <text fg={stateColor()}>{spinnerChar()}</text>
        </Show>
        <text fg={stateColor()}>{activity().description}</text>
        <Show when={activity().elapsedMs !== undefined}>
          <text fg={theme.textMuted}>{formatElapsed(activity().elapsedMs!)}</text>
        </Show>
      </box>
      <Show when={activity().toolSummary}>
        <text fg={theme.textMuted} paddingLeft={2}>
          {activity().toolSummary}
        </text>
      </Show>
    </box>
  )
}
