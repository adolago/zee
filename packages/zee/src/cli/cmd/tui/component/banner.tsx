import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { EmptyBorder } from "@tui/component/border"
import type { JSX } from "solid-js"
import { sanitizeLegacyBannerText, truncateToWidth, type BannerKind } from "./banner-format"

export type BannerItem = {
  kind: BannerKind
  text: string
  priority?: "low" | "normal" | "high" | "urgent"
}

export type BannerProps = {
  topBorder?: JSX.Element
  bottomBorder?: JSX.Element
  items?: Accessor<BannerItem[]>
  rotationMs?: number
  fallback?: string
  layoutWidth?: number
}

export function Banner(props: BannerProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const safeWidth = createMemo(() => Math.max(0, Math.floor(props.layoutWidth ?? dimensions().width)))
  const borderFill = createMemo(() => "─".repeat(safeWidth()))

  const items = createMemo(() => props.items?.() ?? [])
  const [index, setIndex] = createSignal(0)
  const current = createMemo(() => {
    const list = items()
    if (list.length === 0) return undefined
    return list[index() % list.length]
  })

  createEffect(() => {
    const len = items().length
    if (len === 0) {
      setIndex(0)
      return
    }
    if (index() >= len) setIndex(0)
  })

  createEffect(() => {
    const len = items().length
    const ms = props.rotationMs ?? 8000
    if (len <= 1 || ms <= 0) return

    const timer = setInterval(() => {
      setIndex((i) => i + 1)
    }, ms)

    onCleanup(() => clearInterval(timer))
  })

  const maxTextWidth = createMemo(() => Math.max(0, safeWidth() - 2))
  const fallbackText = createMemo(() => props.fallback ?? "Zee banner: no items.")

  const display = createMemo(() => {
    const item = current()
    if (!item) return { kind: undefined, text: truncateToWidth(fallbackText(), maxTextWidth()) }

    const safeText = sanitizeLegacyBannerText(item.kind, item.text)
    return { kind: item.kind, text: truncateToWidth(safeText, maxTextWidth()) }
  })

  return (
    <box flexDirection="column">
      <Show
        when={props.topBorder}
        fallback={
          <box height={1} flexDirection="row" gap={0}>
            <text fg={theme.border} flexShrink={0}>╭</text>
            <text fg={theme.border} flexGrow={1} flexShrink={1} wrapMode="none" overflow="hidden">
              {borderFill()}
            </text>
            <text fg={theme.border} flexShrink={0}>╮</text>
          </box>
        }
      >
        {props.topBorder}
      </Show>

      <box
        border={["left", "right"]}
        borderColor={theme.border}
        customBorderChars={{ ...EmptyBorder, vertical: "│" }}
        paddingTop={1}
        paddingBottom={1}
      >
        <text fg={display().kind ? theme.text : theme.textMuted} flexGrow={1} flexShrink={1} wrapMode="none" overflow="hidden">
          {display().text}
        </text>
      </box>

      <Show
        when={props.bottomBorder}
        fallback={
          <box height={1} flexDirection="row" gap={0}>
            <text fg={theme.border} flexShrink={0}>╰</text>
            <text fg={theme.border} flexGrow={1} flexShrink={1} wrapMode="none" overflow="hidden">
              {borderFill()}
            </text>
            <text fg={theme.border} flexShrink={0}>╯</text>
          </box>
        }
      >
        {props.bottomBorder}
      </Show>
    </box>
  )
}
