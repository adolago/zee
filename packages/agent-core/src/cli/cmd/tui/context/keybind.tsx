import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useVim } from "@tui/context/vim"
import { Keybind } from "@/util/keybind"
import { pipe, mapValues } from "remeda"
import type { KeybindsConfig as SDKKeybindsConfig } from "@agent-core/sdk/v2"
import type { ParsedKey, Renderable } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"

// Extended keybinds type with new keybinds not yet in SDK
export type KeybindsConfig = SDKKeybindsConfig & {
  model_fallback_toggle?: string
  model_provider_list?: string
  input_dictation_toggle?: string
  session_delegate?: string
  session_delete?: string
  stash_delete?: string
  messages_line_up?: string
  messages_line_down?: string
  messages_next?: string
  messages_previous?: string
  messages_last_user?: string
  grammar_quickfix?: string
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
      const hasFocus = renderer.currentFocusedRenderable !== null
      const sequence = typeof evt.sequence === "string" ? evt.sequence : ""

      // Drop mouse SGR sequences that sometimes leak as text (with or without ESC prefix)
      // Example: ESC[<35;143;2M or [<35;143;2M
      if (sequence && /^\x1b?\[<\d+;\d+;\d+[Mm]$/.test(sequence)) {
        evt.stopPropagation()
        evt.preventDefault()
        return
      }
      const canActivateLeader = !hasFocus || (vim.enabled && vim.isNormal)
      if (!store.leader && canActivateLeader && result.match("leader", evt)) {
        // Stop propagation to prevent the textarea from receiving this key
        // This is important because:
        // 1. In vim normal mode, Space should trigger leader mode, not be caught by vim handler
        // 2. The prompt's vim handler would otherwise call preventDefault() for Space
        evt.stopPropagation()
        leader(true)
        return
      }

      // When leader mode is active, block the textarea from receiving keys
      // but let other global handlers (command dialog) process leader+key combos.
      // Uses preventDefault (not stopPropagation) so subsequent global listeners
      // still fire, but renderable handlers (textarea insertion) are skipped.
      if (store.leader) {
        if (evt.name === "escape") {
          evt.stopPropagation()
          leader(false)
          return
        }
        // Block textarea from inserting characters while in leader mode
        evt.preventDefault()
        // Auto-dismiss leader after all global handlers have processed the event.
        // If a command handler matched and called dismiss(), store.leader is already
        // false and this is a no-op. Otherwise this prevents leader from getting stuck.
        setTimeout(() => {
          if (store.leader) leader(false)
        }, 0)
        return
      }

      // Vim normal mode: intercept character keys BEFORE the textarea's handleKeyPress()
      // inserts them. The textarea inserts characters in handleKeyPress() which runs
      // before onKeyDown, so preventDefault() in onKeyDown is too late. We must
      // stopPropagation() here in useKeyboard (which fires before handleKeyPress)
      // to prevent character insertion entirely.
      if (vim.enabled && vim.isNormal) {
        // Escape when textarea is unfocused: refocus without leaving normal mode
        if (!hasFocus && evt.name === "escape") {
          vim.onEnterInsert() // Uses the focus callback to refocus textarea
          vim.enterNormal() // Stay in normal mode
          evt.stopPropagation()
          evt.preventDefault()
          return
        }

        // Text input keys: dispatch to vim command handler and block textarea insertion
        // Handle both name-based keys and printable sequences (kitty keyboard can report text in sequence)
        const isSingleCharName = !!evt.name && evt.name.length === 1
        const sequenceFirst = sequence ? sequence.charCodeAt(0) : 0
        const hasPrintableSequence = sequence.length > 0 && sequenceFirst >= 32 && sequenceFirst !== 127
        const isTextKey =
          !evt.ctrl && !evt.meta && !evt.super && !evt.hyper && (isSingleCharName || hasPrintableSequence)
        if (isTextKey) {
          if (!hasFocus) {
            // Refocus textarea first so the handler has access to it
            vim.onEnterInsert()
            vim.enterNormal()
          }
          if (vimCommandHandler) {
            let key: string | null = null
            if (isSingleCharName && evt.name) {
              key = evt.shift && /^[a-z]$/.test(evt.name) ? evt.name.toUpperCase() : evt.name
            } else if (sequence.length === 1) {
              key = sequence
            }
            if (key) {
              vimCommandHandler(key)
            }
          }
          // Always block: in normal mode, no characters should reach the textarea
          evt.stopPropagation()
          evt.preventDefault()
          return
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
        for (const kb of keybind) {
          if (Keybind.match(kb, parsed)) {
            return true
          }
        }
        return false
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
