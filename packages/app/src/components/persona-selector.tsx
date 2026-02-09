import { For, Show, createMemo } from "solid-js"
import { Button } from "@zee/ui/button"
import { DropdownMenu } from "@zee/ui/dropdown-menu"
import { Tooltip } from "@zee/ui/tooltip"
import { Icon } from "@zee/ui/icon"
import { PERSONAS, type PersonaId } from "@/context/persona"

export type { PersonaId } from "@/context/persona"

export function PersonaSelector(props: { value?: PersonaId; onChange: (persona: PersonaId) => void }) {
  const currentPersona = createMemo(() => {
    const id = props.value ?? "zee"
    return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]
  })

  return (
    <DropdownMenu>
      <Tooltip value={`Current persona: ${currentPersona().name}`} placement="top">
        <DropdownMenu.Trigger
          as={Button}
          variant="ghost"
          class="gap-1.5 px-2 h-7"
          style={{ color: currentPersona().color }}
        >
          <div
            class="size-2.5 rounded-full shrink-0"
            style={{ "background-color": currentPersona().color }}
          />
          <span class="text-13-medium">{currentPersona().name}</span>
          <Icon name="chevron-down" size="small" class="text-icon-weak" />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="min-w-[180px]">
          <For each={PERSONAS}>
            {(persona) => (
              <DropdownMenu.Item
                class="flex items-center gap-2 cursor-pointer"
                onSelect={() => props.onChange(persona.id)}
              >
                <div
                  class="size-2.5 rounded-full shrink-0"
                  style={{ "background-color": persona.color }}
                />
                <div class="flex flex-col min-w-0">
                  <DropdownMenu.ItemLabel class="text-13-medium">
                    {persona.name}
                  </DropdownMenu.ItemLabel>
                  <span class="text-11-regular text-text-weak truncate">
                    {persona.description}
                  </span>
                </div>
                <Show when={persona.id === props.value}>
                  <Icon name="check-small" size="small" class="ml-auto text-icon-interactive-base" />
                </Show>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

export function PersonaSelectorCompact(props: { value?: PersonaId; onChange: (persona: PersonaId) => void }) {
  const currentPersona = createMemo(() => {
    const id = props.value ?? "zee"
    return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]
  })

  return (
    <DropdownMenu>
      <div data-component="persona-selector-compact" data-persona={currentPersona().id} class="inline-flex">
        <Tooltip value={`${currentPersona().name}: ${currentPersona().description}`} placement="top">
          <DropdownMenu.Trigger
            as={Button}
            variant="ghost"
            class="size-7 p-0"
          >
            <div
              class="size-3 rounded-full"
              style={{ "background-color": currentPersona().color }}
            />
          </DropdownMenu.Trigger>
        </Tooltip>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="min-w-[160px]">
          <For each={PERSONAS}>
            {(persona) => (
              <DropdownMenu.Item
                class="flex items-center gap-2 cursor-pointer"
                onSelect={() => props.onChange(persona.id)}
              >
                <div
                  class="size-2.5 rounded-full shrink-0"
                  style={{ "background-color": persona.color }}
                />
                <DropdownMenu.ItemLabel class="text-13-medium flex-1">
                  {persona.name}
                </DropdownMenu.ItemLabel>
                <Show when={persona.id === props.value}>
                  <Icon name="check-small" size="small" class="text-icon-interactive-base" />
                </Show>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
