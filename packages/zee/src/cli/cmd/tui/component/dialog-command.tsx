import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useKeybind, type KeybindsConfig } from "@tui/context/keybind"
import { useVim } from "@tui/context/vim"

type Context = ReturnType<typeof createCommandDialog>
const ctx = createContext<Context>()

export type Slash = {
  name: string
  aliases?: string[]
}

export type CommandOption = DialogSelectOption<string> & {
  keybind?: keyof KeybindsConfig
  slash?: Slash
  hidden?: boolean
  enabled?: boolean
}

export function createCommandDialog() {
  const [registrations, setRegistrations] = createSignal<Accessor<CommandOption[]>[]>([])
  const [suspendCount, setSuspendCount] = createSignal(0)
  const dialog = useDialog()
  const keybind = useKeybind()
  const vim = useVim()

  const entries = () => {
    const all = registrations().flatMap((x) => x() ?? [])
    return all
      .filter((item): item is CommandOption => Boolean(item))
      .map((item) => ({
        ...item,
        footer: (() => {
          if (item.footer) return item.footer
          if (!item.keybind) return undefined
          const binding = keybind.print(item.keybind)
          if (!binding) return undefined
          return binding
        })(),
      }))
  }

  const isEnabled = (option: CommandOption) => option.enabled !== false
  const isVisible = (option: CommandOption) => isEnabled(option) && !option.hidden

  const visibleOptions = () => entries().filter((option) => isVisible(option))
  const suspended = () => suspendCount() > 0

  useKeyboard((evt) => {
    if (suspended()) return
    if (dialog.stack.length > 0) return
    // In vim insert mode, only allow leader-prefixed keybinds through
    // so that plain keys (shift+g, shift+e, etc.) reach the textarea for text input
    const insertMode = vim.enabled && vim.isInsert
    for (const option of entries()) {
      if (!isEnabled(option)) continue
      if (option.keybind && keybind.match(option.keybind, evt)) {
        // Skip non-leader keybinds in insert mode to allow typing accented chars etc.
        // But allow non-printable navigation keys through (they never produce text input).
        if (insertMode && !keybind.leader) {
          const nav = evt.name === "pageup" || evt.name === "pagedown"
            || evt.name === "home" || evt.name === "end"
          if (!nav) continue
        }
        evt.preventDefault()
        option.onSelect?.(dialog)
        // Dismiss leader mode after executing a command
        keybind.dismiss()
        return
      }
    }
  })

  const result = {
    get options() {
      return visibleOptions()
    },
    trigger(name: string) {
      for (const option of entries()) {
        if (option.value === name) {
          if (!isEnabled(option)) return
          option.onSelect?.(dialog)
          return
        }
      }
    },
    slashes() {
      return visibleOptions().flatMap((option) => {
        const slash = option.slash
        if (!slash) return []
        return {
          display: ":" + slash.name,
          description: option.description ?? option.title,
          aliases: slash.aliases?.map((alias) => ":" + alias),
          onSelect: () => result.trigger(option.value),
        }
      })
    },
    keybinds(enabled: boolean) {
      setSuspendCount((count) => count + (enabled ? -1 : 1))
    },
    suspended,
    show() {
      dialog.replace(() => <DialogCommand options={visibleOptions()} />, undefined, { placement: "bottom" })
    },
    register(cb: () => CommandOption[]) {
      const results = createMemo(cb)
      setRegistrations((arr) => [results, ...arr])
      onCleanup(() => {
        setRegistrations((arr) => arr.filter((x) => x !== results))
      })
    },
  }
  return result
}

export function useCommandDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useCommandDialog must be used within a CommandProvider")
  }
  return value
}

export function CommandProvider(props: ParentProps) {
  const value = createCommandDialog()
  const dialog = useDialog()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (value.suspended()) return
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    if (keybind.match("command_list", evt)) {
      evt.preventDefault()
      value.show()
      return
    }
  })

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

function DialogCommand(props: { options: CommandOption[] }) {
  const dialog = useDialog()
  onMount(() => dialog.setSize("large"))
  return <DialogSelect title="Commands" placeholder="Search commands..." options={props.options} />
}
