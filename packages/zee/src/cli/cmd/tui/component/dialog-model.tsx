import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider } from "./dialog-provider"
import { useKeybind } from "../context/keybind"
import * as fuzzysort from "fuzzysort"

/** Get auth status indicator for a provider (placeholder for future implementation) */
function getAuthIndicator(_providerID: string): string {
  // FUTURE: Will show lock/key icons when provider_auth_status is added to sync store
  // For now, returns empty string (no indicator)
  return ""
}

export function useConnected() {
  const sync = useSync()
  return createMemo(() => sync.data.provider.length > 0)
}

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const keybind = useKeybind()
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()

  const options = createMemo(() => {
    const q = query()

    // Filter to only show providers with credentials (connected providers)
    const connectedProviderIds = new Set(sync.data.provider_next.connected)
    const isMiniMax = (provider: { name: string }) => provider.name.toLowerCase().startsWith("minimax")
    const connectedProviders = sync.data.provider.filter((provider) => connectedProviderIds.has(provider.id))
    const preferredProviderID = props.providerID ?? local.model.current()?.providerID
    const minimaxProviders = connectedProviders.filter(isMiniMax)
    let filteredProviders = connectedProviders
    if (minimaxProviders.length > 1) {
      const sortedMiniMax = [...minimaxProviders].sort((a, b) => a.name.localeCompare(b.name))
      const preferred =
        (preferredProviderID && sortedMiniMax.find((p) => p.id === preferredProviderID)?.id) ||
        sortedMiniMax[0]?.id
      if (preferred) {
        filteredProviders = connectedProviders.filter((provider) => !isMiniMax(provider) || provider.id === preferred)
      }
    }

    const providerOptions = pipe(
      filteredProviders,
      sortBy((provider) => provider.name),
      flatMap((provider) => {
        const authIndicator = getAuthIndicator(provider.id)
        return pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => {
            const value = {
              providerID: provider.id,
              modelID: model,
            }
            const isFav = local.model.isFavorite(value)
            return {
              value,
              title: (isFav ? "* " : "") + (info.name ?? model),
              category: connected() ? authIndicator + provider.name : undefined,
              onSelect() {
                dialog.clear()
                local.model.set({
                  providerID: provider.id,
                  modelID: model,
                })
              },
            }
          }),
          sortBy((x) => x.title),
        )
      }),
    )

    // Apply fuzzy filtering
    if (q) {
      return fuzzysort.go(q, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj)
    }

    return providerOptions
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    if (provider()) return provider()!.name
    return "Select model (session)"
  })

  return (
    <DialogSelect
      keybind={[
        {
          keybind: keybind.all.model_provider_list?.[0],
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          keybind: keybind.all.model_favorite_toggle?.[0],
          title: "Toggle favorite",
          onTrigger() {
            // Toggle current model as favorite (the model shown at top of dialog)
            const m = local.model.current()
            if (m) local.model.toggleFavorite(m)
          },
        },
      ]}
      ref={setRef}
      onFilter={setQuery}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
      options={options()}
    />
  )
}
