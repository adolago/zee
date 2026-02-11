import { createSignal, createMemo, Show, For } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { Grammar } from "../util/grammar"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { SplitBorder } from "@tui/component/border"

export function DialogGrammar(props: {
  originalText: string
  matches: Grammar.Match[]
  onApply: (newText: string) => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [currentText, setCurrentText] = createSignal(props.originalText)
  const [matchIndex, setMatchIndex] = createSignal(0)
  const [offsetShift, setOffsetShift] = createSignal(0)

  const currentMatch = createMemo(() => props.matches[matchIndex()])
  
  // Calculate the current actual offset of the match in the modified text
  const currentActualOffset = createMemo(() => {
    const match = currentMatch()
    if (!match) return 0
    return match.offset + offsetShift()
  })

  const contextPreview = createMemo(() => {
    const match = currentMatch()
    if (!match) return null
    const text = currentText()
    const offset = currentActualOffset()
    const len = match.length
    
    const start = Math.max(0, offset - 20)
    const end = Math.min(text.length, offset + len + 20)
    
    const before = text.slice(start, offset)
    const mistake = text.slice(offset, offset + len)
    const after = text.slice(offset + len, end)
    
    return { before, mistake, after }
  })

  function applyReplacement(replacement: string) {
    const text = currentText()
    const offset = currentActualOffset()
    const match = currentMatch()
    if (!match) return

    const before = text.slice(0, offset)
    const after = text.slice(offset + match.length)
    const newText = before + replacement + after
    
    setCurrentText(newText)
    setOffsetShift((s) => s + (replacement.length - match.length))
    next()
  }

  function next() {
    if (matchIndex() < props.matches.length - 1) {
      setMatchIndex((i) => i + 1)
    } else {
      props.onApply(currentText())
      dialog.clear()
    }
  }

  return (
    <Show when={currentMatch()} fallback={null}>
      {(match) => (
        <DialogSelect
          title={`Grammar Check (${matchIndex() + 1}/${props.matches.length})`}
          placeholder="Select a correction..."
          options={[
            ...match().replacements.map((r) => ({
              title: r.value,
              value: r.value,
              onSelect: () => applyReplacement(r.value),
            })),
            {
              title: "Ignore",
              value: "ignore",
              description: "Skip this error",
              onSelect: () => next(),
            },
            {
              title: "Cancel",
              value: "cancel",
              description: "Abort grammar check",
              onSelect: () => dialog.clear(),
            },
          ]}
        >
          <box flexDirection="column" paddingBottom={1}>
            <text fg={theme.warning}>{match().message}</text>
            <box flexDirection="row" marginTop={1} padding={1} border={["top", "bottom", "left", "right"]} borderColor={theme.border} customBorderChars={SplitBorder.customBorderChars}>
              <text fg={theme.textMuted}>{contextPreview()?.before}</text>
              <text fg={theme.error} attributes={TextAttributes.BOLD}>{contextPreview()?.mistake}</text>
              <text fg={theme.textMuted}>{contextPreview()?.after}</text>
            </box>
          </box>
        </DialogSelect>
      )}
    </Show>
  )
}
