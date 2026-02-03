import { TextAttributes } from "@opentui/core"
import { For, createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { resolvePersonaArt } from "./persona-art"

export function Logo() {
  const local = useLocal()
  const { theme } = useTheme()

  const agent = createMemo(() => local.agent.current())
  const art = createMemo(() => resolvePersonaArt(agent().name))
  const color = createMemo(() => local.agent.color(agent().name) ?? theme.primary)

  return (
    <box flexDirection="column" alignItems="center">
      <For each={art()}>
        {(line) => (
          <text fg={color()} attributes={TextAttributes.BOLD} selectable={false}>
            {line}
          </text>
        )}
      </For>
    </box>
  )
}
