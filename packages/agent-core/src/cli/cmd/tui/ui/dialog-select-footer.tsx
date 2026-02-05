import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"

export function renderDialogSelectFooter(
  footer: JSX.Element | string | undefined,
  activeFg: string | RGBA | undefined,
  inactiveFg: string | RGBA | undefined,
  active?: boolean,
): JSX.Element | null {
  if (!footer) return null
  if (typeof footer === "string") {
    return <text fg={active ? activeFg : inactiveFg}>{footer}</text>
  }
  return footer
}
