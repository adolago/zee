import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  const statusIcon = () => {
    switch (props.status) {
      case "completed": return "✓"
      case "in_progress": return "◐"
      case "cancelled": return "✗"
      default: return "○"
    }
  }

  const statusColor = () => {
    switch (props.status) {
      case "completed": return theme.success
      case "in_progress": return theme.warning
      case "cancelled": return theme.error
      default: return theme.textMuted
    }
  }

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        fg={statusColor()}
      >
        {statusIcon()}{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        fg={statusColor()}
        attributes={props.status === "cancelled" ? TextAttributes.STRIKETHROUGH : undefined}
      >
        {props.content}
      </text>
    </box>
  )
}
