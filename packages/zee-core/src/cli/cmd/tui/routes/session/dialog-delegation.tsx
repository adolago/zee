import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import type { PromptInfo } from "@tui/component/prompt/history"

export function DialogDelegation(props: { prompt: PromptInfo; setPrompt: (prompt: PromptInfo) => void }) {
  const local = useLocal()
  const dialog = useDialog()

  const currentAgent = createMemo(() => local.agent.current().name)

  const options = createMemo(() =>
    local.agent
      .list()
      .filter((x) => x.name !== currentAgent())
      .map((item) => ({
        value: item.name,
        title: item.name,
        description: item.description ?? "",
      })),
  )

  return (
    <DialogSelect
      title="Delegate to persona"
      options={options()}
      onSelect={(option) => {
        // Prepend @persona-name to the prompt
        const prefix = `@${option.value} `
        const newInput = props.prompt.input.startsWith("@")
          ? props.prompt.input.replace(/^@\w+\s*/, prefix)
          : prefix + props.prompt.input
        props.setPrompt({
          ...props.prompt,
          input: newInput,
        })
        dialog.clear()
      }}
    />
  )
}
