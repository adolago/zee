import { For, Show, createMemo } from "solid-js"
import { Button } from "@zee/ui/button"
import { DropdownMenu } from "@zee/ui/dropdown-menu"
import { Tooltip } from "@zee/ui/tooltip"
import { Icon } from "@zee/ui/icon"
import { ASSISTANTS, type AssistantId } from "@/context/assistant"

export type { AssistantId } from "@/context/assistant"

export function AssistantSelector(props: { value?: AssistantId; onChange: (assistant: AssistantId) => void }) {
  const currentAssistant = createMemo(() => {
    const id = props.value ?? "zee"
    return ASSISTANTS.find((assistant) => assistant.id === id) ?? ASSISTANTS[0]
  })

  return (
    <DropdownMenu>
      <Tooltip value={`Current assistant: ${currentAssistant().name}`} placement="top">
        <DropdownMenu.Trigger
          as={Button}
          variant="ghost"
          class="gap-1.5 px-2 h-7"
          style={{ color: currentAssistant().color }}
        >
          <div
            class="size-2.5 rounded-full shrink-0"
            style={{ "background-color": currentAssistant().color }}
          />
          <span class="text-13-medium">{currentAssistant().name}</span>
          <Icon name="chevron-down" size="small" class="text-icon-weak" />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="min-w-[180px]">
          <For each={ASSISTANTS}>
            {(assistant) => (
              <DropdownMenu.Item
                class="flex items-center gap-2 cursor-pointer"
                onSelect={() => props.onChange(assistant.id)}
              >
                <div
                  class="size-2.5 rounded-full shrink-0"
                  style={{ "background-color": assistant.color }}
                />
                <div class="flex flex-col min-w-0">
                  <DropdownMenu.ItemLabel class="text-13-medium">
                    {assistant.name}
                  </DropdownMenu.ItemLabel>
                  <span class="text-11-regular text-text-weak truncate">
                    {assistant.description}
                  </span>
                </div>
                <Show when={assistant.id === props.value}>
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

export function AssistantSelectorCompact(props: { value?: AssistantId; onChange: (assistant: AssistantId) => void }) {
  const currentAssistant = createMemo(() => {
    const id = props.value ?? "zee"
    return ASSISTANTS.find((assistant) => assistant.id === id) ?? ASSISTANTS[0]
  })

  return (
    <DropdownMenu>
      <div data-component="assistant-selector-compact" data-assistant={currentAssistant().id} class="inline-flex">
        <Tooltip value={`${currentAssistant().name}: ${currentAssistant().description}`} placement="top">
          <DropdownMenu.Trigger
            as={Button}
            variant="ghost"
            class="size-7 p-0"
          >
            <div
              class="size-3 rounded-full"
              style={{ "background-color": currentAssistant().color }}
            />
          </DropdownMenu.Trigger>
        </Tooltip>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="min-w-[160px]">
          <For each={ASSISTANTS}>
            {(assistant) => (
              <DropdownMenu.Item
                class="flex items-center gap-2 cursor-pointer"
                onSelect={() => props.onChange(assistant.id)}
              >
                <div
                  class="size-2.5 rounded-full shrink-0"
                  style={{ "background-color": assistant.color }}
                />
                <DropdownMenu.ItemLabel class="text-13-medium flex-1">
                  {assistant.name}
                </DropdownMenu.ItemLabel>
                <Show when={assistant.id === props.value}>
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
