import { Clipboard } from "@tui/util/clipboard"

import type { CliRendererConfig } from "@opentui/core"

import type { ResolvedKittyKeyboard } from "./keyboard"

export function buildTuiRenderOptions(kittyKeyboard: Pick<ResolvedKittyKeyboard, "options">): CliRendererConfig {
  return {
    targetFps: 60,
    gatherStats: false,
    exitOnCtrlC: false,
    enableMouseMovement: false,
    useKittyKeyboard: kittyKeyboard.options,
    consoleOptions: {
      keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
      onCopySelection: (text) => {
        Clipboard.copy(text).catch((error) => {
          console.error(`Failed to copy console selection to clipboard: ${error}`)
        })
      },
    },
  }
}
