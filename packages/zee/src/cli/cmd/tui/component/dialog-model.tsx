import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, flatMap, entries, filter, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider } from "./dialog-provider"
import { useKeybind } from "../context/keybind"
import {
  hasVisibleSessionModelProviders,
  listVisibleSessionModelProviders,
  type SessionModelPickerAuthStatus,
} from "@tui/util/session-model-picker"
import * as fuzzysort from "fuzzysort"

function getAuthIndicator(providerID: string, authStatus: Record<string, SessionModelPickerAuthStatus>): string {
  const status = authStatus[providerID]
  if (!status?.expiringSoon) return ""
  return "! "
}

function getVisibleSessionProviders(
  providers: ReturnType<typeof useSync>["data"]["provider"],
  connectedProviderIDs: Iterable<string>,
  authStatus: Record<string, SessionModelPickerAuthStatus>,
) {
  return listVisibleSessionModelProviders(providers, {
    connectedProviderIDs,
    authStatus,
  })
}

function getPreferredVisibleProviders(
  providers: ReturnType<typeof useSync>["data"]["provider"],
  preferredProviderID?: string,
) {
  const isMiniMax = (provider: { name: string }) => provider.name.toLowerCase().startsWith("minimax")
  const minimaxProviders = providers.filter(isMiniMax)
  if (minimaxProviders.length <= 1) return providers

  const sortedMiniMax = [...minimaxProviders].sort((a, b) => a.name.localeCompare(b.name))
  const preferred =
    (preferredProviderID && sortedMiniMax.find((provider) => provider.id === preferredProviderID)?.id) ||
    sortedMiniMax[0]?.id
  if (!preferred) return providers

  return providers.filter((provider) => !isMiniMax(provider) || provider.id === preferred)
}

function getConnectedSessionProviderState(sync: ReturnType<typeof useSync>) {
  return {
    connectedProviderIDs: sync.data.provider_next.connected,
    authStatus: sync.data.provider_auth_status,
  }
}

function getProviderCategory(
  providerID: string,
  providerName: string,
  authStatus: Record<string, SessionModelPickerAuthStatus>,
) {
  return getAuthIndicator(providerID, authStatus) + providerName
}

export function useConnected() {
  const sync = useSync()
  return createMemo(() => {
    const state = getConnectedSessionProviderState(sync)
    return hasVisibleSessionModelProviders(sync.data.provider, state)
  })
}

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const keybind = useKeybind()
  const [ref, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()

  const visibleProviders = createMemo(() => {
    const preferredProviderID = props.providerID ?? local.model.current()?.providerID
    const state = getConnectedSessionProviderState(sync)
    const providers = getVisibleSessionProviders(sync.data.provider, state.connectedProviderIDs, state.authStatus)
    return getPreferredVisibleProviders(providers, preferredProviderID)
  })

  const options = createMemo(() => {
    const q = query()

    const providerOptions = pipe(
      visibleProviders(),
      sortBy((provider) => provider.name),
      flatMap((provider) =>
        pipe(
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
              category: connected()
                ? getProviderCategory(provider.id, provider.name, sync.data.provider_auth_status)
                : undefined,
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
        ),
      ),
    )

    // Apply fuzzy filtering
    if (q) {
      return fuzzysort.go(q, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj)
    }

    return providerOptions
  })

  const provider = createMemo(() =>
    props.providerID ? visibleProviders().find((x) => x.id === props.providerID) ?? null : null,
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
