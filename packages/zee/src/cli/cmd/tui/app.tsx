import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { TextAttributes, RGBA } from "@opentui/core"
import { RouteProvider, useRoute } from "@tui/context/route"
import { Switch, Match, createEffect, untrack, ErrorBoundary, createSignal, onMount, batch, Show, on } from "solid-js"
import { Installation } from "@/installation"
import { Flag } from "@/flag/flag"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderList } from "@tui/component/dialog-provider"
import { SDKProvider, useSDK } from "@tui/context/sdk"
import { SyncProvider, useSync } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel } from "@tui/component/dialog-model"
import { DialogMcp } from "@tui/component/dialog-mcp"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogHelp } from "./ui/dialog-help"
import { DialogLegend } from "./ui/dialog-legend"
// DialogReleaseButton removed -- mode is now a 3-state cycle (plan/accept/bypass)
import { WhichKey } from "@tui/component/which-key"
import { CommandProvider, useCommandDialog } from "@tui/component/dialog-command"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { KeybindProvider } from "@tui/context/keybind"
import { ThemeProvider, isNoColorEnabled, generateMonochromeTheme, resolveTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptStashProvider } from "./component/prompt/stash"
import { DialogAlert } from "./ui/dialog-alert"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import { Session as SessionApi } from "@/session"
import { Todo } from "@/session/todo"
import { TuiEvent } from "./event"
import { KVProvider, useKV } from "./context/kv"
import { Provider } from "@/provider/provider"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import { VimProvider, useVim } from "./context/vim"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import open from "open"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { normalizeHttpUrl } from "@/util/net"
import { Terminal } from "./util/terminal"

function modeFromBackground(background: RGBA | null): "dark" | "light" {
  if (!background) return "dark"
  const { r, g, b } = background
  const scale = r > 1 || g > 1 || b > 1 ? 255 : 1
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / scale
  return luminance > 0.5 ? "light" : "dark"
}

import type { EventSource } from "./context/sdk"

export function tui(input: {
  url: string
  args: Args
  directory?: string
  fetch?: typeof fetch
  events?: EventSource
  onExit?: () => Promise<void>
}) {
  // promise to prevent immediate exit
  return new Promise<void>(async (resolve) => {
    const terminalBackground = await Terminal.backgroundColor(200)
    const mode = modeFromBackground(terminalBackground)
    const kittyKeyboardConfig = await Instance.provide({
      directory: input.directory ?? process.cwd(),
      fn: async () => {
        const cfg = await Config.get()
        if (cfg.tui?.kitty_keyboard === false) return null
        // Always enable events + allKeysAsEscapes for PTT hold-to-record
        return { events: true, allKeysAsEscapes: true }
      },
    }).catch(() => ({ events: true, allKeysAsEscapes: true }) as Record<string, boolean> | null)
    const onExit = async () => {
      await input.onExit?.()
      resolve()
    }

    render(
      () => {
        return (
          <ErrorBoundary
            fallback={(error, reset) => <ErrorComponent error={error} reset={reset} onExit={onExit} mode={mode} />}
          >
            <ArgsProvider {...input.args}>
              <ExitProvider onExit={onExit}>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider>
                      <SDKProvider
                        url={input.url}
                        directory={input.directory}
                        fetch={input.fetch}
                        events={input.events}
                      >
                        <SyncProvider>
                          <ThemeProvider mode={mode} terminalBackground={terminalBackground}>
                            <InnerProviders />
                          </ThemeProvider>
                        </SyncProvider>
                      </SDKProvider>
                    </RouteProvider>
                  </ToastProvider>
                </KVProvider>
              </ExitProvider>
            </ArgsProvider>
          </ErrorBoundary>
        )
      },
      {
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: kittyKeyboardConfig ?? undefined,
        consoleOptions: {
          keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
          onCopySelection: (text) => {
            Clipboard.copy(text).catch((error) => {
              console.error(`Failed to copy console selection to clipboard: ${error}`)
            })
          },
        },
      },
    )
  })
}

// Extracted to reduce JSX nesting depth -- babel-preset-solid's codegen
// emits "undefined" instead of whitespace at ~16 levels of nesting.
function InnerProviders() {
  return (
    <LocalProvider>
      <VimProvider>
        <KeybindProvider>
          <PromptStashProvider>
            <PromptRefProvider>
              <DialogProvider>
                <CommandProvider>
                  <FrecencyProvider>
                    <PromptHistoryProvider>
                      <App />
                    </PromptHistoryProvider>
                  </FrecencyProvider>
                </CommandProvider>
              </DialogProvider>
            </PromptRefProvider>
          </PromptStashProvider>
        </KeybindProvider>
      </VimProvider>
    </LocalProvider>
  )
}

function App() {
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  // renderer.disableStdoutInterception()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const command = useCommandDialog()
  const sdk = useSDK()
  const toast = useToast()
  const sync = useSync()
  const exit = useExit()
  const promptRef = usePromptRef()
  const vim = useVim()

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await Clipboard.copy(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)
    renderer.clearSelection()
  }
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))


  // Update terminal window title based on current route, session, and active persona
  createEffect(() => {
    if (!terminalTitleEnabled()) return

    // Get the current persona name (titlecased)
    const persona = local.agent.current().name
    const personaTitle = persona.charAt(0).toUpperCase() + persona.slice(1).toLowerCase()

    if (route.data.type === "home") {
      renderer.setTerminalTitle(personaTitle)
      return
    }

    if (route.data.type === "session") {
      const session = sync.session.get(route.data.sessionID)
      if (!session || SessionApi.isDefaultTitle(session.title)) {
        renderer.setTerminalTitle(personaTitle)
        return
      }

      // Truncate title to 40 chars max
      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`${personaTitle} | ${title}`)
    }
  })

  const args = useArgs()
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Provider.parseModel(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID })
      }
      if (args.sessionID) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
        })
      }
    })
  })

  let continued = false
  createEffect(() => {
    // When using -c, session list is loaded in blocking phase, so we can navigate at "partial"
    if (continued || sync.status === "loading" || !args.continue) return
    const match = sync.data.session
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .find((x) => x.parentID === undefined)?.id
    if (match) {
      continued = true
      route.navigate({ type: "session", sessionID: match })
    }
  })

  createEffect(
    on(
      () => sync.status === "complete" && sync.data.provider.length === 0,
      (isEmpty, wasEmpty) => {
        // only trigger when we transition into an empty-provider state
        if (!isEmpty || wasEmpty) return
        dialog.replace(() => <DialogProviderList />)
      },
    ),
  )

  // Check for sessions with incomplete todos on startup (Phase 0.3 recovery)
  let checkedIncompleteTodos = false
  createEffect(() => {
    if (checkedIncompleteTodos || sync.status !== "complete") return
    checkedIncompleteTodos = true

    // Load todos directly from storage for all sessions
    ;(async () => {
      let sessionsWithTodos = 0
      let totalIncompleteTodos = 0

      for (const session of sync.data.session) {
        const todos = await Todo.get(session.id)
        const incomplete = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")
        if (incomplete.length > 0) {
          sessionsWithTodos++
          totalIncompleteTodos += incomplete.length
        }
      }

      if (sessionsWithTodos > 0) {
        toast.show({
          variant: "info",
          message: `◐ ${totalIncompleteTodos} pending todo${totalIncompleteTodos > 1 ? "s" : ""} in ${sessionsWithTodos} session${sessionsWithTodos > 1 ? "s" : ""}`,
          duration: 5000,
        })
      }
    })()
  })

  command.register(() => [
    {
      title: "Switch session",
      value: "session.list",
      keybind: "session_list",
      category: "Session",
      onSelect: () => {
        dialog.replace(() => <DialogSessionList />)
      },
    },
    {
      title: "New session",
      value: "session.new",
      keybind: "session_new",
      category: "Session",
      slash: {
        name: "new",
        aliases: ["clear"],
      },
      onSelect: () => {
        const current = promptRef.current
        // Don't require focus - if there's any text, preserve it
        const currentPrompt = current?.current?.input ? current.current : undefined
        route.navigate({
          type: "home",
          initialPrompt: currentPrompt,
        })
        dialog.clear()
      },
    },
    {
      title: "Switch model",
      value: "model.list",
      keybind: "model_list",
      category: "Agent",
      slash: {
        name: "models",
      },
      onSelect: () => {
        dialog.replace(() => <DialogModel />, undefined, { minimal: true })
      },
    },
    {
      title: "Toggle fallback model",
      value: "model.fallback_toggle",
      keybind: "model_fallback_toggle",
      category: "Agent",
      onSelect: () => {
        if (!local.model.hasFallback()) {
          toast.show({ message: "No fallback model configured for this agent", variant: "warning", duration: 2000 })
          return
        }
        const isNowFallback = local.model.toggleFallback()
        toast.show({
          message: isNowFallback ? "Switched to fallback model" : "Switched to primary model",
          variant: "info",
          duration: 2000,
        })
      },
    },
    {
      title: "Toggle MCPs",
      value: "mcp.list",
      category: "Agent",
      slash: {
        name: "mcps",
      },
      onSelect: () => {
        dialog.replace(() => <DialogMcp />)
      },
    },
	    {
	      title: "Variant cycle",
	      value: "variant.cycle",
	      keybind: "variant_cycle",
	      category: "Agent",
	      onSelect: () => {
	        local.model.variant.cycle()
	      },
	    },
    {
      title: "Toggle model favorite",
      value: "model.favorite_toggle",
      keybind: "model_favorite_toggle",
      category: "Agent",
      onSelect: (dialog) => {
        const m = local.model.current()
        if (!m) return
        local.model.toggleFavorite(m)
        const isFav = local.model.isFavorite(m)
        toast.show({
          message: isFav ? "Added to favorites" : "Removed from favorites",
          variant: "info",
          duration: 2000,
        })
        dialog.clear()
      },
    },
    {
      title: "Next favorite model",
      value: "model.cycle_favorite",
      keybind: "model_cycle_favorite",
      category: "Agent",
      hidden: true,
      onSelect: (dialog) => {
        if (!local.model.cycleFavorite(1)) {
          toast.show({ message: "No favorite models set", variant: "warning", duration: 2000 })
        }
        dialog.clear()
      },
    },
    {
      title: "Previous favorite model",
      value: "model.cycle_favorite_reverse",
      keybind: "model_cycle_favorite_reverse",
      category: "Agent",
      hidden: true,
      onSelect: (dialog) => {
        if (!local.model.cycleFavorite(-1)) {
          toast.show({ message: "No favorite models set", variant: "warning", duration: 2000 })
        }
        dialog.clear()
      },
    },
    {
      title: `Cycle mode (${local.mode.mode().toUpperCase()} -> next)`,
      value: "mode.cycle",
      keybind: "mode_cycle",
      category: "Mode",
      onSelect: () => {
        local.mode.cycle()
        setTimeout(() => vim.onEnterInsert(), 10)
      },
    },
    {
      title: "Connect provider",
      value: "provider.connect",
      onSelect: () => {
        dialog.replace(() => <DialogProviderList />)
      },
      category: "Provider",
    },
    {
      title: "Grammar",
      value: "prompt.grammar.menu",
      keybind: "grammar_menu",
      category: "Prompt",
      onSelect: (dialog) => {
        const promptInput = promptRef.current?.current?.input ?? ""
        if (!promptInput.trim()) {
          toast.show({ message: "No prompt text to check", variant: "warning", duration: 2000 })
          dialog.clear()
          return
        }
        command.trigger("prompt.grammar")
      },
    },
    {
      title: "View status",
      keybind: "status_view",
      value: "opencode.status",
      slash: {
        name: "status",
      },
      onSelect: () => {
        dialog.replace(() => <DialogStatus />)
      },
      category: "System",
    },
    {
      title: "View legend",
      value: "opencode.legend",
      keybind: "legend_view",
      slash: {
        name: "legend",
      },
      onSelect: () => {
        dialog.replace(() => <DialogLegend />)
      },
      category: "System",
    },
    {
      get title() {
        return kv.get("animations_enabled", true) ? "Disable animations" : "Enable animations"
      },
      value: "animations.toggle",
      onSelect: (dialog) => {
        kv.set("animations_enabled", !kv.get("animations_enabled", true))
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Help",
      value: "help.show",
      keybind: "help_view",
      slash: {
        name: "help",
      },
      onSelect: () => {
        dialog.replace(() => <DialogHelp />)
      },
      category: "System",
    },
    {
      title: "Open docs",
      value: "docs.open",
      onSelect: () => {
        const url = normalizeHttpUrl("https://github.com/adolago/zee/tree/dev/docs")
        if (url) open(url).catch(() => {})
        dialog.clear()
      },
      category: "System",
    },
    {
      title: "Exit the app",
      value: "app.exit",
      slash: {
        name: "exit",
        aliases: ["quit", "q"],
      },
      onSelect: () => exit(),
      category: "System",
    },
  ])

  sdk.event.on(TuiEvent.CommandExecute.type, (evt) => {
    command.trigger(evt.properties.command)
  })

  sdk.event.on(TuiEvent.ToastShow.type, (evt) => {
    toast.show({
      title: evt.properties.title,
      message: evt.properties.message,
      variant: evt.properties.variant,
      duration: evt.properties.duration,
    })
  })

  sdk.event.on(TuiEvent.SessionSelect.type, (evt) => {
    route.navigate({
      type: "session",
      sessionID: evt.properties.sessionID,
    })
  })

  sdk.event.on(SessionApi.Event.Deleted.type, (evt) => {
    if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: "The current session was deleted",
      })
    }
  })

  sdk.event.on(SessionApi.Event.Error.type, (evt) => {
    const error = evt.properties.error
    if (error && typeof error === "object" && error.name === "MessageAbortedError") return
    const message = (() => {
      if (!error) return "An error occurred"

      if (typeof error === "object") {
        const data = error.data
        if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
          return data.message
        }
        // Fallback for malformed errors with message at top level
        if ("message" in error && typeof error.message === "string") {
          return error.message
        }
      }
      return String(error)
    })()

    toast.show({
      variant: "error",
      message,
      duration: 5000,
    })
  })

  sdk.event.on(Installation.Event.Updated.type, (evt) => {
    toast.show({
      variant: "success",
      title: "Update Complete",
      message: `zee updated to v${evt.properties.version}`,
      duration: 5000,
    })
  })
  sdk.event.on(Installation.Event.UpdateAvailable.type, (evt) => {
    toast.show({
      variant: "info",
      title: "Update Available",
      message: `zee v${evt.properties.version} is available. Run 'zee upgrade' to update manually.`,
      duration: 10000,
    })
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={RGBA.fromInts(0, 0, 0, 0)}
      onMouseUp={async () => {
        if (Flag.ZEE_DISABLE_COPY_ON_SELECT) {
          renderer.clearSelection()
          return
        }
        const text = renderer.getSelection()?.getSelectedText()
        if (text && text.length > 0) {
          await Clipboard.copy(text)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
          renderer.clearSelection()
        }
      }}
    >
      <Switch>
        <Match when={route.data.type === "home"}>
          <Home />
        </Match>
        <Match when={route.data.type === "session"}>
          <Session />
        </Match>
      </Switch>
      <WhichKey />
    </box>
  )
}

/**
 * Monochrome fallback colors when theme context is unavailable.
 * Respects NO_COLOR environment variable.
 */
const MonochromeColors = (mode: "dark" | "light") => {
  // If NO_COLOR is set, use monochrome theme
  if (isNoColorEnabled()) {
    const theme = resolveTheme(generateMonochromeTheme(mode), mode)
    return {
      bg: theme.background,
      text: theme.text,
      muted: theme.textMuted,
      primary: theme.text,
    }
  }

  // Otherwise use mode-appropriate colors from the default theme
  const isLight = mode === "light"
  return {
    bg: isLight ? "#fafafa" : "#0a0a0a",
    text: isLight ? "#1a1a1a" : "#eeeeee",
    muted: isLight ? "#6a6a6a" : "#888888",
    primary: isLight ? "#3b7dd8" : "#fab283",
  }
}

function ErrorComponent(props: {
  error: Error
  reset: () => void
  onExit: () => Promise<void>
  mode?: "dark" | "light"
}) {
  const term = useTerminalDimensions()
  const renderer = useRenderer()

  const handleExit = async () => {
    renderer.setTerminalTitle("")
    renderer.destroy()
    props.onExit()
  }

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "c") {
      handleExit()
    }
  })
  const [copied, setCopied] = createSignal(false)

  const issueURL = new URL("https://github.com/adolago/zee/issues/new?template=bug-report.yml")

  // Use theme-aware colors with NO_COLOR support
  const colors = MonochromeColors(props.mode ?? "dark")

  if (props.error.message) {
    issueURL.searchParams.set("title", `opentui: fatal: ${props.error.message}`)
  }

  if (props.error.stack) {
    issueURL.searchParams.set(
      "description",
      "```\n" + props.error.stack.substring(0, 6000 - issueURL.toString().length) + "...\n```",
    )
  }

  issueURL.searchParams.set("zee-version", Installation.VERSION)

  const copyIssueURL = () => {
    Clipboard.copy(issueURL.toString()).then(() => {
      setCopied(true)
    })
  }

  return (
    <box flexDirection="column" gap={1} backgroundColor={colors.bg}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text attributes={TextAttributes.BOLD} fg={colors.text}>
          Please report an issue.
        </text>
        <box onMouseUp={copyIssueURL} backgroundColor={colors.primary} padding={1}>
          <text attributes={TextAttributes.BOLD} fg={colors.bg}>
            Copy issue URL (exception info pre-filled)
          </text>
        </box>
        {copied() && <text fg={colors.muted}>Successfully copied</text>}
      </box>
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg={colors.text}>A fatal error occurred!</text>
        <box onMouseUp={props.reset} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>Reset TUI</text>
        </box>
        <box onMouseUp={handleExit} backgroundColor={colors.primary} padding={1}>
          <text fg={colors.bg}>Exit</text>
        </box>
      </box>
      <scrollbox height={Math.floor(term().height * 0.7)}>
        <text fg={colors.muted}>{props.error.stack}</text>
      </scrollbox>
      <text fg={colors.text}>{props.error.message}</text>
    </box>
  )
}
