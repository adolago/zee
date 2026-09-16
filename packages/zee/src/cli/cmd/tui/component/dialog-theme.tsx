import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createMemo } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"

export function DialogTheme() {
  const dialog = useDialog()
  const themeState = useTheme()

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const themes = themeState.all()
    const active = themeState.selected
    return Object.keys(themes)
      .sort()
      .map((id) => ({
        title: (id === active ? "* " : "") + id,
        description: id === active ? "Current theme" : "",
        value: id,
        category: "Themes",
        onSelect: () => {
          themeState.set(id)
          dialog.clear()
        },
      }))
  })

  return <DialogSelect title="Themes" placeholder="Search themes…" options={options()} />
}
