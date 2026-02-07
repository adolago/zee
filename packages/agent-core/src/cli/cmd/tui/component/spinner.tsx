import { createSignal, onCleanup, type JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { RGBA } from "@opentui/core"

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: string | RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const animated = () => kv.get("animations_enabled", true)
  const color = () => props.color ?? theme.textMuted

  const [index, setIndex] = createSignal(0)
  const interval = setInterval(() => {
    if (animated()) setIndex((i) => (i + 1) % BRAILLE_FRAMES.length)
  }, 80)
  onCleanup(() => clearInterval(interval))

  const frame = () => (animated() ? BRAILLE_FRAMES[index()] : "...")

  return (
    <box flexDirection="row" gap={1}>
      <text fg={color()}>{frame()}</text>
      {props.children}
    </box>
  )
}
