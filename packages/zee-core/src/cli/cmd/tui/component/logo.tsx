import { TextAttributes, RGBA } from "@opentui/core"
import { For, createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { resolvePersonaArt } from "./persona-art"
import { personaPalettes, type PersonaId } from "@root/theme/rosetta"

export function Logo() {
  const local = useLocal()
  const { theme } = useTheme()

  const agent = createMemo(() => local.agent.current())
  const art = createMemo(() => resolvePersonaArt(agent().name))
  const color = createMemo(() => {
    const name = agent().name.toLowerCase() as PersonaId
    const palette = personaPalettes[name]
    if (palette) return RGBA.fromHex(palette.accent.hex)
    return local.agent.color(agent().name) ?? theme.primary
  })

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
