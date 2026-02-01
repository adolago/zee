import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useSync } from "@tui/context/sync"
import { createSimpleContext } from "./helper"

export type VimMode = "normal" | "insert"

export const { use: useVim, provider: VimProvider } = createSimpleContext({
  name: "Vim",
  init: () => {
    const sync = useSync()

    // Check if vim mode is enabled from config (default: true)
    const enabled = createMemo(() => {
      const tui = sync.data.config.tui as { vim?: { enabled?: boolean; start_in_insert?: boolean } } | undefined
      return tui?.vim?.enabled !== false
    })

    // Check if we should start in insert mode (default: false)
    const startInInsert = createMemo(() => {
      const tui = sync.data.config.tui as { vim?: { enabled?: boolean; start_in_insert?: boolean } } | undefined
      return tui?.vim?.start_in_insert === true
    })

    // Initialize mode: if vim disabled or start_in_insert, use insert; otherwise normal
    const [store, setStore] = createStore<{ mode: VimMode }>({
      mode: startInInsert() ? "insert" : "normal",
    })

    // Focus callback for when entering insert mode
    let focusCallback: (() => void) | null = null

    // Track previous enabled state to detect transitions
    let prevEnabled = enabled()

    // Reset mode to default when vim is re-enabled to avoid stale state
    createEffect(() => {
      const currentEnabled = enabled()
      if (!prevEnabled && currentEnabled) {
        // Transitioning from disabled to enabled: reset to configured default
        setStore("mode", startInInsert() ? "insert" : "normal")
      }
      prevEnabled = currentEnabled
    })

    // Cleanup focus callback on unmount to avoid stale references
    onCleanup(() => {
      focusCallback = null
    })

    return {
      get enabled() {
        return enabled()
      },
      get mode() {
        return enabled() ? store.mode : ("insert" as VimMode)
      },
      get isNormal() {
        return enabled() && store.mode === "normal"
      },
      get isInsert() {
        return !enabled() || store.mode === "insert"
      },
      setMode(mode: VimMode) {
        if (!enabled()) return
        setStore("mode", mode)
      },
      enterNormal() {
        if (!enabled()) return
        setStore("mode", "normal")
      },
      enterInsert() {
        if (enabled()) {
          setStore("mode", "insert")
        }
        // Always fire focus callback regardless of vim mode
        focusCallback?.()
      },
      // Register a callback to be called when entering insert mode
      registerFocusCallback(fn: () => void) {
        focusCallback = fn
      },
      // Call the focus callback (for use after entering insert mode)
      onEnterInsert() {
        focusCallback?.()
      },
    }
  },
})
