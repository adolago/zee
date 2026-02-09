import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Help
        </text>
        <text fg={theme.textMuted}>esc/enter</text>
      </box>
      <box paddingBottom={1} gap={1}>
        <text fg={theme.textMuted}>
          Press {keybind.print("command_list")} to see all available actions and commands.
        </text>
        <text fg={theme.textMuted}>
          Type <span style={{ fg: theme.text }}>:legend</span> to explain status bar symbols and abbreviations.
        </text>
        <text fg={theme.textMuted}>
          Type <span style={{ fg: theme.text }}>:status</span> to see detailed system status.
        </text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={2} paddingRight={2} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
