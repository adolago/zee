import { createMemo, For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind, type KeybindsConfig } from "@tui/context/keybind"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { Keybind } from "@/util/keybind"
import { RoundedBorder } from "@tui/component/border"
import { overlayBottomOffset } from "@tui/ui/overlay"

type KeybindEntry = {
  key: string
  action: string
  description: string
}

type KeybindCategory = {
  name: string
  entries: KeybindEntry[]
}

// Map keybind names to human-readable descriptions and categories
// Only essential commands are shown - less common ones still work but aren't displayed
const KEYBIND_META: Record<string, { category: string; description: string }> = {
  // Session - most used
  session_new: { category: "Session", description: "[n]ew" },
  session_list: { category: "Session", description: "[l]ist" },
  session_delete: { category: "Session", description: "[d]elete" },
  session_compact: { category: "Session", description: "[c]ompact" },
  session_timeline: { category: "Session", description: "timelin[g]" },

  // Model
  model_list: { category: "Model", description: "[m]odels" },
  variant_cycle: { category: "Model", description: "[v]ariants" },

  // Messages
  messages_copy: { category: "Messages", description: "[y]ank" },
  messages_undo: { category: "Messages", description: "[u]ndo" },
  messages_toggle_thinking: { category: "Messages", description: "th[i]nking" },
  tool_details: { category: "Messages", description: "[d]etails" },
  messages_toggle_scrollbar: { category: "Messages", description: "[S]crollbar" },

  // Grammar
  grammar_menu: { category: "Grammar", description: "[G]rammar check" },

  // UI
  mode_toggle: { category: "UI", description: "[h]old mode" },
  mode_cycle: { category: "UI", description: "mode [c]ycle" },
  status_view: { category: "UI", description: "[s]tatus" },
  sidebar_toggle: { category: "UI", description: "side[b]ar" },

  // App
  command_list: { category: "App", description: "[c]ommands" },
  legend_view: { category: "App", description: "[?] legend" },
  app_exit: { category: "App", description: "[q]uit" },
}

// Category display order - most used first
const CATEGORY_ORDER = ["Session", "Agent", "Model", "Messages", "Grammar", "UI", "App"]

export function WhichKey() {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()

  // Get all leader-based keybindings grouped by category
  const categories = createMemo(() => {
    const all = keybind.all as Record<string, Keybind.Info[] | undefined>
    const result: Map<string, KeybindEntry[]> = new Map()

    for (const [name, bindings] of Object.entries(all)) {
      if (!bindings || bindings.length === 0) continue

      // Find bindings that use leader key
      const leaderBinding = bindings.find((b) => b.leader)
      if (!leaderBinding) continue

      const meta = KEYBIND_META[name]
      if (!meta) continue

      const keyStr = leaderBinding.name || ""
      if (!keyStr) continue

      // Format the key display (add modifiers if any)
      let display = keyStr.toUpperCase()
      if (leaderBinding.shift) display = "⇧" + display
      if (leaderBinding.ctrl) display = "^" + display
      if (leaderBinding.meta) display = "⌥" + display

      const entries = result.get(meta.category) || []
      entries.push({
        key: display,
        action: name,
        description: meta.description,
      })
      result.set(meta.category, entries)
    }

    // Sort entries within each category by key
    for (const entries of result.values()) {
      entries.sort((a, b) => a.key.localeCompare(b.key))
    }

    // Convert to array and sort by category order
    const categorized: KeybindCategory[] = []
    for (const categoryName of CATEGORY_ORDER) {
      const entries = result.get(categoryName)
      if (entries && entries.length > 0) {
        categorized.push({ name: categoryName, entries })
      }
    }

    return categorized
  })

  // Calculate layout - try to fit in available width
  const scale = 1.33
  const columnWidth = Math.max(22, Math.round(20 * scale))
  const maxColumns = createMemo(() => Math.max(1, Math.floor((dimensions().width - 4) / columnWidth)))
  const promptOffset = createMemo(() => overlayBottomOffset(dimensions().height))

  return (
    <Show when={keybind.leader}>
      <box
        position="absolute"
        left={0}
        right={0}
        bottom={promptOffset()}
        justifyContent="flex-end"
        alignItems="center"
        zIndex={1500}
        overflow="hidden"
        paddingBottom={1}
      >
        <box
          backgroundColor={theme.backgroundMenu}
          {...RoundedBorder}
          borderColor={theme.borderActive}
          paddingLeft={3}
          paddingRight={3}
          paddingTop={2}
          paddingBottom={2}
          overflow="hidden"
          flexShrink={1}
          maxWidth={Math.min(dimensions().width - 2, maxColumns() * columnWidth + 10)}
        >
          <box flexDirection="column" gap={0}>
            {/* Header */}
            <box paddingBottom={1} flexDirection="row" justifyContent="space-between">
              <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
                Leader
              </text>
              <text fg={theme.textMuted} wrapMode="none">
                esc
              </text>
            </box>

            {/* Categories in columns */}
            <box flexDirection="row" flexWrap="wrap" gap={3}>
              <For each={categories()}>
                {(category) => (
                  <box flexDirection="column" minWidth={columnWidth - 2}>
                    <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
                      {category.name}
                    </text>
                    <For each={category.entries}>
                      {(entry) => (
                        <box flexDirection="row" gap={1}>
                          <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                            <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none">
                              {entry.key.padEnd(3)}
                            </text>
                          </box>
                          <text fg={theme.textMuted}>{entry.description}</text>
                        </box>
                      )}
                    </For>
                  </box>
                )}
              </For>
            </box>
          </box>
        </box>
      </box>
    </Show>
  )
}
