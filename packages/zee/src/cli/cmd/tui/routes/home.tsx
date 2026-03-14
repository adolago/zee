import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, Match, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { Logo } from "../component/logo"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { StatusBar as StatusBarStyle } from "../../../style"
import { Header as HeaderStyles } from "@tui/ui/header-footer"
import { useTerminalDimensions } from "@opentui/solid"

// Module-level flag to prevent initial prompt from being set multiple times
// This ensures the prompt is only auto-filled once per app lifecycle
let once = false

export function Home() {
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const dimensions = useTerminalDimensions()
  const keybind = useKeybind()
  const homePromptWidth = createMemo(() => Math.max(0, Math.min(dimensions().width, 100)))
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })
  const runtimeLabel = createMemo(() => {
    const runtime = Installation.runtimeInfo()
    return `${runtime.version} (${runtime.channel}/${runtime.mode})`
  })

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={0}>
        <text fg={theme.textMuted}>{StatusBarStyle.separator}</text>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>⊙</span>
              <span style={{ fg: theme.textMuted }}> </span>
              mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>{keybind.print("status_view")}</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>⊙</span>
              <span style={{ fg: theme.textMuted }}> </span>
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef
  const args = useArgs()
  onMount(() => {
    if (once) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
      prompt.submit()
    }
  })
  const directory = useDirectory()
  const dirParts = createMemo(() => {
    const dir = directory()
    const [path, ...rest] = dir.split(":")
    const parts = path.split("/")
    return {
      parent: parts.slice(0, -1).join("/"),
      repo: parts.at(-1) ?? "",
      branch: rest.length > 0 ? rest.join(":") : null,
    }
  })

  return (
    <>
      <box flexGrow={1} justifyContent="center" alignItems="center" paddingLeft={0} paddingRight={0} gap={1}>
        <box height={3} />
        <Logo />
        <box width="100%" maxWidth={100} zIndex={1000} paddingTop={1}>
          <Prompt
            ref={(r) => {
              prompt = r
              promptRef.set(r)
            }}
            hint={Hint}
            layoutWidth={homePromptWidth()}
          />
        </box>
        <Toast />
      </box>
      <box
        paddingTop={HeaderStyles.padding.top}
        paddingBottom={HeaderStyles.padding.bottom}
        paddingLeft={HeaderStyles.padding.left}
        paddingRight={HeaderStyles.padding.right}
        flexDirection="row"
        flexShrink={HeaderStyles.flexShrink}
        gap={0}
      >
        <text>
          <span style={{ fg: theme.textMuted }}>{dirParts().parent ? `${dirParts().parent}/` : ""}</span>
          <span style={{ fg: theme.text }}>
            {dirParts().repo}
            {dirParts().branch ? `:${dirParts().branch}` : ""}
          </span>
        </text>
        <Show when={mcp()}>
          <text fg={theme.border}>{StatusBarStyle.separator}</text>
          <box gap={0} flexDirection="row" flexShrink={0}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>⊙</span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>⊙</span>
                </Match>
              </Switch>
              <span style={{ fg: theme.textMuted }}> </span>
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.border}>{StatusBarStyle.separator}</text>
            <text fg={theme.textMuted}>:status</text>
          </box>
        </Show>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{runtimeLabel()}</text>
        </box>
      </box>
    </>
  )
}
