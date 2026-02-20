import path from "path"
import { Global } from "@/global"
import { onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { clone } from "remeda"
import { createSimpleContext } from "../../context/helper"
import { appendFile, writeFile } from "fs/promises"
import type { PromptInfo } from "./types"
import { logPromptPartSanitization, sanitizePromptPartsAgainstInput } from "./parts"

export type { PromptInfo } from "./types"

const MAX_HISTORY_ENTRIES = 50

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const historyFile = Bun.file(path.join(Global.Path.state, "prompt-history.jsonl"))
    onMount(async () => {
      const text = await historyFile.text().catch(() => "")
      const shouldRewrite = text.trim().length > 0
      const lines = text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter((line): line is PromptInfo => line !== null)
        .slice(-MAX_HISTORY_ENTRIES)
        .map((line, index) => {
          const sanitized = sanitizePromptPartsAgainstInput(line.input, line.parts)
          logPromptPartSanitization(`prompt-history.load.${index}`, sanitized)
          return {
            ...line,
            parts: sanitized.parts,
          }
        })

      setStore("history", lines)

      // Rewrite file with only valid entries to self-heal corruption
      if (shouldRewrite) {
        const content = lines.length > 0 ? lines.map((line) => JSON.stringify(line)).join("\n") + "\n" : ""
        writeFile(historyFile.name!, content).catch(() => {})
      }
    })

    const [store, setStore] = createStore({
      index: 0,
      history: [] as PromptInfo[],
    })

    return {
      move(direction: 1 | -1, input: string) {
        if (!store.history.length) return undefined
        const current = store.history.at(store.index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
        setStore(
          produce((draft) => {
            const next = store.index + direction
            if (Math.abs(next) > store.history.length) return
            if (next > 0) return
            draft.index = next
          }),
        )
        if (store.index === 0)
          return {
            input: "",
            parts: [],
          }
        return store.history.at(store.index)
      },
      append(item: PromptInfo) {
        const sanitized = sanitizePromptPartsAgainstInput(item.input, item.parts)
        logPromptPartSanitization("prompt-history.append", sanitized)
        const entry = clone({ ...item, parts: sanitized.parts })
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.history.push(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES) {
              draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
              trimmed = true
            }
            draft.index = 0
          }),
        )

        if (trimmed) {
          const content = store.history.map((line) => JSON.stringify(line)).join("\n") + "\n"
          writeFile(historyFile.name!, content).catch(() => {})
          return
        }

        appendFile(historyFile.name!, JSON.stringify(entry) + "\n").catch(() => {})
      },
    }
  },
})
