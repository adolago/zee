import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "solid-js"

export type BannerItem = {
  kind: "reminder" | "todo" | "message"
  text: string
  priority?: "low" | "normal" | "high" | "urgent"
}

export type BannerProps = {
  topBorder?: JSX.Element
  bottomBorder?: JSX.Element
  items?: Accessor<BannerItem[]>
  rotationMs?: number
  fallback?: string
}

function sanitizeOneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return ""
  if (text.length <= maxChars) return text
  if (maxChars <= 3) return text.slice(0, maxChars)
  return text.slice(0, maxChars - 3) + "..."
}

function kindLabel(kind: BannerItem["kind"]): string {
  switch (kind) {
    case "reminder":
      return "REM"
    case "todo":
      return "TODO"
    case "message":
      return "MSG"
  }
}

export function Banner(props: BannerProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const fill = createMemo(() => "─".repeat(dimensions().width))

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

  const maxTextWidth = createMemo(() => Math.max(0, dimensions().width - 2))
  const fallbackText = createMemo(() => props.fallback ?? "Zee banner: no items.")

  const display = createMemo(() => {
    const item = current()
    if (!item) return { label: undefined, kind: undefined, text: truncate(fallbackText(), maxTextWidth()) }

    const label = kindLabel(item.kind)
    const prefix = `[${label}] `
    const safeText = sanitizeOneLine(item.text)
    const remaining = Math.max(0, maxTextWidth() - prefix.length)
    const text = truncate(safeText, remaining)
    return { label, kind: item.kind, text }
  })

  const labelColor = createMemo(() => {
    const { kind } = display()
    if (!kind) return theme.textMuted
    if (kind === "reminder") return theme.accent
    if (kind === "todo") return theme.warning
    return theme.textMuted
  })

  return (
    <box flexDirection="column" backgroundColor={theme.background}>
      <Show
        when={props.topBorder}
        fallback={
          <box height={1} flexDirection="row" gap={0}>
            <text fg={theme.border} flexShrink={0}>╭</text>
            <text fg={theme.border} flexGrow={1} flexShrink={1} wrapMode="none" overflow="hidden">
              {fill()}
            </text>
            <text fg={theme.border} flexShrink={0}>╮</text>
          </box>
        }
      >
        {props.topBorder}
      </Show>

      <box flexDirection="row" gap={0} paddingTop={1} paddingBottom={1}>
        <text fg={theme.border} flexShrink={0}>│</text>
        <text flexGrow={1} flexShrink={1} wrapMode="none" overflow="hidden">
          <Show
            when={display().label}
            fallback={<span style={{ fg: theme.textMuted }}>{display().text}</span>}
          >
            {(label) => (
              <>
                <span style={{ fg: theme.textMuted }}>[</span>
                <span style={{ fg: labelColor() }}>{label()}</span>
                <span style={{ fg: theme.textMuted }}>] </span>
                <span style={{ fg: theme.text }}>{display().text}</span>
              </>
            )}
          </Show>
        </text>
        <text fg={theme.border} flexShrink={0}>│</text>
      </box>

      <Show
        when={props.bottomBorder}
        fallback={
          <box height={1} flexDirection="row" gap={0}>
            <text fg={theme.border} flexShrink={0}>╰</text>
            <text fg={theme.border} flexGrow={1} flexShrink={1} wrapMode="none" overflow="hidden">
              {fill()}
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
