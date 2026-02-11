import { createMemo, For, Match, Switch } from "solid-js"
import { useRouteData, useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import type { Session } from "@zee/sdk/v2"
import { useKeybind } from "../../context/keybind"
import { Locale } from "@/util/locale"
import { Header as HeaderStyles } from "@tui/ui/header-footer"

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const { navigate } = useRoute()
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  // Build ancestry chain for breadcrumbs
  const ancestry = createMemo(() => {
    const chain: Session[] = []
    let current = session()
    while (current?.parentID) {
      const parent = sync.data.session.find((s) => s.id === current!.parentID)
      if (!parent) break
      chain.unshift(parent)
      current = parent
    }
    return chain
  })

  const { theme } = useTheme()
  const keybind = useKeybind()
  return (
    <box flexShrink={0}>
      <box
        paddingTop={HeaderStyles.padding.top}
        paddingBottom={HeaderStyles.padding.bottom}
        paddingLeft={HeaderStyles.padding.left}
        paddingRight={HeaderStyles.padding.right}
      >
        <Switch>
          <Match when={session()?.parentID}>
            <box flexDirection="column" gap={0}>
              <box flexDirection={narrow() ? "column" : "row"} gap={narrow() ? 0 : 1} alignItems={narrow() ? "flex-start" : "center"}>
                <For each={ancestry()}>
                  {(ancestor) => (
                    <>
                      <text
                        fg={theme.accent}
                        onMouseDown={() =>
                          navigate({ type: "session", sessionID: ancestor.id })
                        }
                      >
                        {Locale.truncateMiddle(ancestor.title ?? "Session", 20)}
                      </text>
                      <text fg={theme.textMuted}>&gt;</text>
                    </>
                  )}
                </For>
                <text fg={theme.text}>
                  <b>
                    {Locale.truncateMiddle(session()?.title ?? "Current", 20)}
                  </b>
                </text>
                <box flexGrow={1} flexShrink={1} />
              </box>
              <box flexDirection="row" gap={2}>
                <text fg={theme.textMuted}>
                  Parent{" "}
                  <span style={{ fg: theme.textMuted }}>
                    {keybind.print("session_parent")}
                  </span>
                </text>
                <text fg={theme.textMuted}>
                  Prev{" "}
                  <span style={{ fg: theme.textMuted }}>
                    {keybind.print("session_child_cycle_reverse")}
                  </span>
                </text>
                <text fg={theme.textMuted}>
                  Next{" "}
                  <span style={{ fg: theme.textMuted }}>
                    {keybind.print("session_child_cycle")}
                  </span>
                </text>
              </box>
            </box>
          </Match>
          <Match when={true}>
            <box height={0} />
          </Match>
        </Switch>
      </box>
    </box>
  )
}
