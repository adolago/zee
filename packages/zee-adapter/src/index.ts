/**
 * OpenCode Adapter
 *
 * Bridges the OpenCode Web UI with zee daemon.
 * Provides TUI-matching theme and session/tool translation.
 */

export { OpenCodeAdapter, createAdapter } from "./adapter"
export { SessionBridge } from "./bridge/session"
export { ToolBridge } from "./bridge/tool"
export { ConfigBridge } from "./bridge/config"
export { ThemeProvider, useTheme, applyTuiTheme } from "./theme/provider.jsx"
export type {
  AdapterConfig,
  Session,
  Message,
  MessageStream,
  Tool,
  ToolResult,
} from "./types"
