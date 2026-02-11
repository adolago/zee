import { createSignal, createMemo, onMount } from "solid-js"
import { createSimpleContext } from "@zee/ui/context"

export const PERSONAS = [
  { id: "zee", name: "Zee", description: "Personal assistant", color: "#268bd2" },
] as const

export type PersonaId = (typeof PERSONAS)[number]["id"]
export type Persona = (typeof PERSONAS)[number]

const STORAGE_KEY = "zee.persona"

export function isPersonaId(id: string): id is PersonaId {
  return PERSONAS.some((p) => p.id === id)
}

export function getStoredPersona(): PersonaId {
  if (typeof window === "undefined") return "zee"
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && isPersonaId(stored)) {
    return stored
  }
  return "zee"
}

export function setStoredPersona(id: PersonaId) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, id)
}

export const { use: usePersona, provider: PersonaProvider } = createSimpleContext({
  name: "Persona",
  init: () => {
    const [personaId, setPersonaId] = createSignal<PersonaId>("zee")

    onMount(() => {
      setPersonaId(getStoredPersona())
    })

    const set = (id: PersonaId) => {
      setStoredPersona(id)
      setPersonaId(id)
    }

    const current = createMemo(() => PERSONAS.find((p) => p.id === personaId())!)

    const cycle = (direction: 1 | -1 = 1) => {
      const currentIndex = PERSONAS.findIndex((p) => p.id === personaId())
      let nextIndex = currentIndex + direction
      if (nextIndex < 0) nextIndex = PERSONAS.length - 1
      if (nextIndex >= PERSONAS.length) nextIndex = 0
      set(PERSONAS[nextIndex].id)
    }

    return {
      id: personaId,
      current,
      set,
      cycle,
      list: () => PERSONAS,
    }
  },
})
