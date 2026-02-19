import type { JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { RGBA } from "@opentui/core"
import { useAnimationTick } from "../util/animation-tick"
import { promptSpinnerFrame } from "../ui/prompt-spinner"

export function Spinner(props: { children?: JSX.Element; color?: string | RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const animated = () => kv.get("animations_enabled", true)
  const color = () => props.color ?? theme.textMuted

  const tick = useAnimationTick()
  const frame = () => promptSpinnerFrame(tick(), animated())

  return (
    <box flexDirection="row" gap={1}>
      <text fg={color()}>{frame()}</text>
      {props.children}
    </box>
  )
}
