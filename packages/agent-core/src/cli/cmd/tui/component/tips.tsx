import { For, Show, createMemo, type Accessor } from "solid-js"
import { DEFAULT_THEMES, useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import type { JSX } from "solid-js"

const themeCount = Object.keys(DEFAULT_THEMES).length
const themeTip = `Use {highlight}:theme{/highlight} or {highlight}Space T{/highlight} to preview and switch between ${themeCount} built-in themes.`

type TipPart = { text: string; highlight: boolean }

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

export type TipsProps = {
  topBorder?: JSX.Element
  bottomBorder?: JSX.Element
  billboard?: Accessor<string | undefined>
}

export function Tips(props: TipsProps) {
  const theme = useTheme().theme
  const dimensions = useTerminalDimensions()
  const fill = createMemo(() => "─".repeat(dimensions().width))
  const randomTip = TIPS[Math.floor(Math.random() * TIPS.length)]
  const displayText = createMemo(() => props.billboard?.() || randomTip)
  const parts = createMemo(() => parse(displayText()))

  return (
    <box flexDirection="column">
      {/* Rounded top border - either custom or default */}
      <Show when={props.topBorder} fallback={
        <box height={1} flexDirection="row">
          <text fg={theme.border} flexShrink={0}>╭</text>
          <text fg={theme.border} flexGrow={1} flexShrink={1}>{fill()}</text>
          <text fg={theme.border} flexShrink={0}>╮</text>
        </box>
      }>
        {props.topBorder}
      </Show>
      {/* Content row with side borders */}
      <box flexDirection="row">
        <text fg={theme.border} flexShrink={0}>│</text>
        <text flexGrow={1} flexShrink={1}>
          <For each={parts()}>
            {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
          </For>
        </text>
        <text fg={theme.border} flexShrink={0}>│</text>
      </box>
      {/* Bottom border - either custom or default rounded */}
      <Show when={props.bottomBorder} fallback={
        <box height={1} flexDirection="row">
          <text fg={theme.border} flexShrink={0}>╰</text>
          <text fg={theme.border} flexGrow={1} flexShrink={1}>{fill()}</text>
          <text fg={theme.border} flexShrink={0}>╯</text>
        </box>
      }>
        {props.bottomBorder}
      </Show>
    </box>
  )
}

export const TIPS = [
  "Type {highlight}@{/highlight} followed by a filename to fuzzy search and attach files to your prompt.",
  "Start a message with {highlight}!{/highlight} to run shell commands directly (e.g., {highlight}!ls -la{/highlight}).",
  "Press {highlight}Space H{/highlight} to toggle between HOLD (research) and RELEASE (edit) modes.",
  "Use {highlight}:undo{/highlight} to revert the last message and any file changes made by agent-core.",
  "Use {highlight}:redo{/highlight} to restore previously undone messages and file changes.",
  "Use {highlight}:share{/highlight} to create a public link to your conversation.",
  "Drag and drop images into the terminal to add them as context for your prompts.",
  "Press {highlight}Ctrl+V{/highlight} to paste images from your clipboard directly into the prompt.",
  "Press {highlight}Space E{/highlight} or {highlight}:editor{/highlight} to compose messages in your external editor.",
  "Run {highlight}:init{/highlight} to auto-generate project rules based on your codebase structure.",
  "Run {highlight}:models{/highlight} or {highlight}Space M{/highlight} to see and switch between available AI models.",
  themeTip,
  "Press {highlight}Space N{/highlight} or {highlight}:new{/highlight} to start a fresh conversation session.",
  "Use {highlight}:sessions{/highlight} or {highlight}Space L{/highlight} to list and continue previous conversations.",
  "Run {highlight}:compact{/highlight} to summarize long sessions when approaching context limits.",
  "Press {highlight}Space X{/highlight} or {highlight}:export{/highlight} to save the conversation as Markdown.",
  "Press {highlight}Space Y{/highlight} to copy the assistant's last message to clipboard.",
  "Press {highlight}Space C{/highlight} to see all available actions and commands.",
  "Run {highlight}:connect{/highlight} to add API keys for 75+ supported LLM providers.",
  "The default leader key is {highlight}Space{/highlight}; combine with other keys for quick actions.",
  "Press {highlight}Space B{/highlight} to show/hide the sidebar panel.",
  "Use {highlight}PageUp{/highlight}/{highlight}PageDown{/highlight} to navigate through conversation history.",
  "Press {highlight}Ctrl+G{/highlight} or {highlight}Home{/highlight} to jump to the beginning of the conversation.",
  "Press {highlight}Ctrl+Alt+G{/highlight} or {highlight}End{/highlight} to jump to the most recent message.",
  "Press {highlight}Shift+Enter{/highlight} or {highlight}Ctrl+J{/highlight} to add newlines in your prompt.",
  "Press {highlight}Ctrl+C{/highlight} when typing to clear the input field.",
  "Press {highlight}Space Esc{/highlight} to stop the AI mid-response.",
  "Use {highlight}HOLD{/highlight} mode to research without making changes, {highlight}RELEASE{/highlight} to edit files.",
  "Use {highlight}@<agent-name>{/highlight} in prompts to invoke specialized subagents.",
  "Press {highlight}Space Right/Left{/highlight} to cycle through parent and child sessions.",
  "Create {highlight}agent-core.jsonc{/highlight} in project root for project-specific settings.",
  "Place settings in {highlight}~/.config/agent-core/agent-core.jsonc{/highlight} for global config.",
  "Add {highlight}$schema{/highlight} to your config for autocomplete in your editor.",
  "Configure {highlight}model{/highlight} in config to set your default model.",
  "Override any keybind in config via the {highlight}keybinds{/highlight} section.",
  "Set any keybind to {highlight}none{/highlight} to disable it completely.",
  "Configure local or remote MCP servers in the {highlight}mcp{/highlight} config section.",
  "Add {highlight}.md{/highlight} files to {highlight}.agent-core/command/{/highlight} to define reusable custom prompts.",
  "Use {highlight}$ARGUMENTS{/highlight}, {highlight}$1{/highlight}, {highlight}$2{/highlight} in custom commands for dynamic input.",
  "Use backticks in commands to inject shell output (e.g., {highlight}`git status`{/highlight}).",
  "Add {highlight}.md{/highlight} files to {highlight}.agent-core/agent/{/highlight} for specialized AI personas.",
  "Configure per-agent permissions for {highlight}edit{/highlight}, {highlight}bash{/highlight}, and {highlight}webfetch{/highlight} tools.",
  'Use patterns like {highlight}"git *": "allow"{/highlight} for granular bash permissions.',
  'Set {highlight}"rm -rf *": "deny"{/highlight} to block destructive commands.',
  'Configure {highlight}"git push": "ask"{/highlight} to require approval before pushing.',
  'Set {highlight}"formatter": false{/highlight} in config to disable all auto-formatting.',
  "Define custom formatter commands with file extensions in config.",
  "Create {highlight}.ts{/highlight} files in {highlight}.agent-core/tool/{/highlight} to define new LLM tools.",
  "Tool definitions can invoke scripts written in Python, Go, etc.",
  "Add {highlight}.ts{/highlight} files to {highlight}.agent-core/plugin/{/highlight} for event hooks.",
  "Use plugins to send OS notifications when sessions complete.",
  "Create a plugin to prevent agent-core from reading sensitive files.",
  "Use {highlight}agent-core run{/highlight} for non-interactive scripting.",
  "Use {highlight}agent-core run --continue{/highlight} to resume the last session.",
  "Use {highlight}agent-core run -f file.ts{/highlight} to attach files via CLI.",
  "Use {highlight}--format json{/highlight} for machine-readable output in scripts.",
  "Run {highlight}agent-core serve{/highlight} for headless API access.",
  "Use {highlight}agent-core run --attach{/highlight} to connect to a running server for faster runs.",
  "Run {highlight}agent-core upgrade{/highlight} to update to the latest version.",
  "Run {highlight}agent-core auth list{/highlight} to see all configured providers.",
  "Run {highlight}agent-core agent create{/highlight} for guided agent creation.",
  'Use {highlight}"theme": "system"{/highlight} to match your terminal\'s colors.',
  "Create JSON theme files in {highlight}.agent-core/themes/{/highlight} directory.",
  "Themes support dark/light variants for both modes.",
  "Reference ANSI colors 0-255 in custom themes.",
  "Use {highlight}{env:VAR_NAME}{/highlight} syntax to reference environment variables in config.",
  "Use {highlight}{file:path}{/highlight} to include file contents in config values.",
  "Use {highlight}instructions{/highlight} in config to load additional rules files.",
  "Set agent {highlight}temperature{/highlight} from 0.0 (focused) to 1.0 (creative).",
  "Configure {highlight}maxSteps{/highlight} to limit agentic iterations per request.",
  'Set {highlight}"tools": {"bash": false}{/highlight} to disable specific tools.',
  'Use {highlight}"mcp_*": false{/highlight} to disable all tools from an MCP server.',
  "Override global tool settings per agent configuration.",
  "Permission {highlight}doom_loop{/highlight} prevents infinite tool call loops.",
  "Permission {highlight}external_directory{/highlight} protects files outside project.",
  "Run {highlight}agent-core debug config{/highlight} to troubleshoot configuration.",
  "Use {highlight}--print-logs{/highlight} flag to see detailed logs in stderr.",
  "Press {highlight}Space G{/highlight} or {highlight}:timeline{/highlight} to jump to specific messages.",
  "Press {highlight}Space H{/highlight} to toggle code block visibility in messages.",
  "Press {highlight}Space S{/highlight} or {highlight}:status{/highlight} to see system status info.",
  "Toggle username display in chat via command palette ({highlight}Space C{/highlight}).",
  "Type {highlight}:q{/highlight} or {highlight}exit{/highlight} to quit agent-core.",
  "Use {highlight}:review{/highlight} to review uncommitted changes, branches, or PRs.",
  "Use {highlight}:details{/highlight} to toggle tool execution details visibility.",
  "Use {highlight}:rename{/highlight} to rename the current session.",
  "Press {highlight}Ctrl+Z{/highlight} to suspend the terminal and return to your shell.",
  "Press {highlight}Tab{/highlight}/{highlight}Shift+Tab{/highlight} to switch between Zee, Stanley, and Johny.",
  "Press {highlight}Space{/highlight} (leader key) to see all available keybindings in a which-key popup.",
  "Press {highlight}Shift+G{/highlight} to jump to the most recent message (vim-style).",
]
