import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useVim } from "@tui/context/vim"
import { Keybind } from "@/util/keybind"
import { pipe, mapValues } from "remeda"
import type { KeybindsConfig as SDKKeybindsConfig } from "@agent-core/sdk/v2"
import type { ParsedKey, Renderable } from "@opentui/core"
import { InputRenderable } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"

// Extended keybinds type with new keybinds not yet in SDK
export type KeybindsConfig = SDKKeybindsConfig & {
  model_fallback_toggle?: string
  model_provider_list?: string
  model_favorite_toggle?: string
  model_cycle_favorite?: string
  model_cycle_favorite_reverse?: string
  mode_release_policy_toggle?: string
  input_dictation_toggle?: string
  session_delegate?: string
  session_delete?: string
  stash_delete?: string
  messages_line_up?: string
  messages_line_down?: string
  messages_toggle_thinking?: string
  messages_next?: string
  messages_previous?: string
  messages_last_user?: string
  grammar_quickfix?: string
  grammar_menu?: string
  help_view?: string
  legend_view?: string
  // Vim mode keybinds
  vim_normal_mode?: string
  vim_insert_mode?: string
}

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const sync = useSync()
    const vim = useVim()
    const keybinds = createMemo(() => {
      return pipe(
        (sync.data.config.keybinds ?? {}) as KeybindsConfig,
        mapValues((value) => Keybind.parse(value)),
      ) as { [K in keyof KeybindsConfig]?: Keybind.Info[] }
    })
    const shiftLetterBindings = createMemo(() => {
      const set = new Set<string>()
      const all = keybinds()
      for (const bindings of Object.values(all)) {
        for (const binding of bindings ?? []) {
          if (!binding.shift) continue
          if (!binding.name || binding.name.length !== 1) continue
          const scope = binding.leader ? "leader" : "plain"
          set.add(`${scope}:${binding.name}`)
        }
      }
      return set
    })
    const [store, setStore] = createStore({
      leader: false,
    })
    const renderer = useRenderer()

    let vimCommandHandler: ((key: string) => boolean) | null = null
    let focus: Renderable | null
    function isRenderableInTree(root: Renderable, target: Renderable): boolean {
      if (root === target) return true
      for (const child of root.getChildren()) {
        if (isRenderableInTree(child, target)) return true
      }
      return false
    }
    function leader(active: boolean) {
      if (active) {
        setStore("leader", true)
        focus = renderer.currentFocusedRenderable
        if (focus?.isDestroyed) {
          focus = null
          return
        }
        focus?.blur()
        return
      }

      if (!active) {
        const previousFocus = focus
        setStore("leader", false)
        if (!previousFocus) return
        setTimeout(() => {
          if (previousFocus.isDestroyed) return
          if (renderer.currentFocusedRenderable?.focused) return
          if (!isRenderableInTree(renderer.root, previousFocus)) return
          previousFocus.focus()
        }, 1)
      }
    }

    // Global keyboard handler for leader key activation and vim commands
    useKeyboard((evt) => {
      // Activate leader mode if:
      // - No focus (original behavior for non-textarea contexts)
      // - OR vim mode is enabled AND we're in vim normal mode
      // This allows Space to work as leader key in vim normal mode even when textarea is focused
      const focused = renderer.currentFocusedRenderable
      const hasFocus = focused !== null
      const isInputElement = focused instanceof InputRenderable
      // Allow leader activation in empty input fields (e.g., session search) so leader keybinds
      // remain usable even when dialogs auto-focus their filter input.
      const inputIsEmpty = isInputElement && focused.value.length === 0
      const canActivateLeader = !hasFocus || (vim.enabled && vim.isNormal && !isInputElement) || inputIsEmpty
      if (!store.leader && canActivateLeader && result.match("leader", evt)) {
        // Stop propagation to prevent the textarea from receiving this key
        // This is important because:
        // 1. In vim normal mode, Space should trigger leader mode, not be caught by vim handler
        // 2. The prompt's vim handler would otherwise call preventDefault() for Space
        evt.stopPropagation()
        leader(true)
        return
      }

      // Only Escape dismisses the which-key popup without executing an action
      // Other keys are handled by individual components which call leader(false) explicitly
      // Note: Escape is safe here because leader mode only activates in vim normal mode,
      // so there's no conflict with vim insert mode's Escape handling
      if (store.leader && evt.name === "escape") {
        evt.stopPropagation()
        leader(false)
        return
      }

      // When vim normal mode is active and textarea is unfocused, refocus on Escape
      if (vim.enabled && vim.isNormal && !store.leader && !hasFocus) {
        if (evt.name === "escape") {
          vim.onEnterInsert() // Uses the focus callback to refocus textarea
          vim.enterNormal() // Stay in normal mode
          evt.stopPropagation()
          evt.preventDefault()
          return
        }

        // Forward single-char keys to the registered vim command handler
        // so vim navigation/commands work even when textarea is unfocused
        if (evt.name && evt.name.length === 1 && !evt.ctrl && !evt.meta && vimCommandHandler) {
          // Refocus textarea first so the handler has access to it
          vim.onEnterInsert()
          vim.enterNormal()
          const handled = vimCommandHandler(evt.name)
          if (handled) {
            evt.stopPropagation()
            evt.preventDefault()
            return
          }
        }
      }
    })

    const result = {
      get all() {
        return keybinds()
      },
      get leader() {
        return store.leader
      },
      dismiss() {
        leader(false)
      },
      get savedFocus() {
        return focus
      },
      parse(evt: ParsedKey): Keybind.Info {
        // Handle special case for Ctrl+Underscore (represented as \x1F)
        if (evt.name === "\x1F") {
          return Keybind.fromParsedKey({ ...evt, name: "_", ctrl: true }, store.leader)
        }
        return Keybind.fromParsedKey(evt, store.leader)
      },
      match(key: keyof KeybindsConfig, evt: ParsedKey): boolean {
        const keybind = keybinds()[key]
        if (!keybind) return false
        const parsed: Keybind.Info = result.parse(evt)
        return Keybind.matchAny(keybind, parsed, { shiftLetterBindings: shiftLetterBindings() })
      },
      print(key: keyof KeybindsConfig) {
        const first = keybinds()[key]?.at(0)
        if (!first) return ""
        const result = Keybind.toString(first)
        return result.replace("<leader>", Keybind.toString(keybinds().leader![0]!))
      },
      registerVimCommandHandler(handler: (key: string) => boolean) {
        vimCommandHandler = handler
      },
      unregisterVimCommandHandler() {
        vimCommandHandler = null
      },
    }
    return result
  },
})
