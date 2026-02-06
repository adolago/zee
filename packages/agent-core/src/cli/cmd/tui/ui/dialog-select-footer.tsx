import type { JSX } from "solid-js"
import { TextAttributes, type RGBA } from "@opentui/core"

export function renderDialogSelectFooter(
  footer: JSX.Element | string | undefined,
  activeFg: string | RGBA | undefined,
  inactiveFg: string | RGBA | undefined,
  active?: boolean,
  keycapBackground?: RGBA,
  keycapForeground?: RGBA,
): JSX.Element | null {
  if (!footer) return null
  if (typeof footer === "string") {
    if (keycapBackground && keycapForeground) {
      return (
        <box backgroundColor={keycapBackground} paddingLeft={1} paddingRight={1}>
          <text fg={keycapForeground} attributes={TextAttributes.BOLD} wrapMode="none">
            {footer}
          </text>
        </box>
      )
    }
    return <text fg={active ? activeFg : inactiveFg}>{footer}</text>
  }
  return footer
}
