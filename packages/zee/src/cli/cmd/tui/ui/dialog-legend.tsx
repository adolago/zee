import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard } from "@opentui/solid"

export function DialogLegend() {
  const dialog = useDialog()
  const { theme } = useTheme()

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Legend
        </text>
        <text fg={theme.textMuted}>esc/enter</text>
      </box>

      <box gap={1} paddingBottom={1}>
        <box>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Vim Mode (enabled by default)
          </text>
          <text fg={theme.textMuted}>  NORMAL   Navigate/command mode (Esc to enter)</text>
          <text fg={theme.textMuted}>  INSERT   Typing mode (i/a/o to enter)</text>
          <text fg={theme.textMuted}>  i        Enter insert at cursor</text>
          <text fg={theme.textMuted}>  a        Enter insert after cursor</text>
          <text fg={theme.textMuted}>  o        Open line below and insert</text>
          <text fg={theme.textMuted}>  O        Open line above and insert</text>
          <text fg={theme.textMuted}>  A        Append at end of line</text>
          <text fg={theme.textMuted}>  I        Insert at start of line</text>
          <text fg={theme.textMuted}>  Space    Leader key (opens command menu)</text>
          <text fg={theme.textMuted}>  Esc      Return to normal mode</text>
        </box>

        <box>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Agent Mode
          </text>
          <text fg={theme.textMuted}>  HOLD     Agent paused, research only</text>
          <text fg={theme.textMuted}>  RELEASE  Agent can edit files</text>
          <text fg={theme.textMuted}>  NO CUFFS Release mode with skipPermissions (allows everything)</text>
          <text fg={theme.textMuted}>  Space h  Toggle hold/release mode</text>
          <text fg={theme.textMuted}>  Space H  Toggle release policy (safe/no cuffs)</text>
          <text fg={theme.textMuted}>  Space c  Commands: "Release button settings"</text>
        </box>

        <box>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Stream Status
          </text>
          <text fg={theme.textMuted}>  ◐ thinking  Waiting for model to respond</text>
          <text fg={theme.textMuted}>  ◐ waiting   Response taking longer than expected</text>
          <text fg={theme.textMuted}>  ⚠ delayed   Response taking much longer than expected</text>
          <text fg={theme.textMuted}>  ⊘ stalled   No response, may need retry</text>
        </box>

        <box>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Connectivity
          </text>
          <text fg={theme.textMuted}>  Net       Internet connection status</text>
          <text fg={theme.textMuted}>  Providers LLM provider connections</text>
          <text fg={theme.textMuted}>  LSP       Language server protocol status</text>
          <text fg={theme.textMuted}>  MCP       Model context protocol (tool servers)</text>
        </box>

        <box>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Stats
          </text>
          <text fg={theme.textMuted}>  mbd   Tokens embedded (memory) this session</text>
          <text fg={theme.textMuted}>  rrnk  Documents reranked this session</text>
          <text fg={theme.textMuted}>  Ctx   Context window usage percentage</text>
        </box>

        <box>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Status Indicators
          </text>
          <text fg={theme.textMuted}>  ● green  Connected/OK</text>
          <text fg={theme.textMuted}>  ● red    Error/disconnected</text>
          <text fg={theme.textMuted}>  ● gray   Checking/unknown</text>
        </box>
      </box>

      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={2} paddingRight={2} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
