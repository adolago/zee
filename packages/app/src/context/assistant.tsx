import { createSignal, createMemo, onMount } from "solid-js"
import { createSimpleContext } from "@zee/ui/context"

export const ASSISTANTS = [
  { id: "zee", name: "Zee", description: "Personal assistant", color: "#268bd2" },
] as const

export type AssistantId = (typeof ASSISTANTS)[number]["id"]
export type Assistant = (typeof ASSISTANTS)[number]

const STORAGE_KEY = "zee.assistant"

export function isAssistantId(id: string): id is AssistantId {
  return ASSISTANTS.some((assistant) => assistant.id === id)
}

export function getStoredAssistant(): AssistantId {
  if (typeof window === "undefined") return "zee"
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && isAssistantId(stored)) {
    return stored
  }
  return "zee"
}

export function setStoredAssistant(id: AssistantId) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, id)
}

export const { use: useAssistant, provider: AssistantProvider } = createSimpleContext({
  name: "Assistant",
  init: () => {
    const [assistantId, setAssistantId] = createSignal<AssistantId>("zee")

    onMount(() => {
      setAssistantId(getStoredAssistant())
    })

    const set = (id: AssistantId) => {
      setStoredAssistant(id)
      setAssistantId(id)
    }

    const current = createMemo(() => ASSISTANTS.find((assistant) => assistant.id === assistantId())!)

    const cycle = (direction: 1 | -1 = 1) => {
      const currentIndex = ASSISTANTS.findIndex((assistant) => assistant.id === assistantId())
      let nextIndex = currentIndex + direction
      if (nextIndex < 0) nextIndex = ASSISTANTS.length - 1
      if (nextIndex >= ASSISTANTS.length) nextIndex = 0
      set(ASSISTANTS[nextIndex].id)
    }

    return {
      id: assistantId,
      current,
      set,
      cycle,
      list: () => ASSISTANTS,
    }
  },
})
