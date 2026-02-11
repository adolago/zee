import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createMemo } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"

export type DialogSkillProps = {
  onSelect: (command: string) => void
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const sync = useSync()

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const commands = sync.data.command ?? []
    return commands.map((cmd) => ({
      title: cmd.id,
      description: cmd.description ?? "",
      value: cmd.id,
      category: "Skills",
      onSelect: () => {
        props.onSelect(cmd.id)
        dialog.clear()
      },
    }))
  })

  return <DialogSelect title="Skills" placeholder="Search skills..." options={options()} />
}
