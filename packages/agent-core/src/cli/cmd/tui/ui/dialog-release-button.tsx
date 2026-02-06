import { onMount } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "./toast"
import { useKV } from "../context/kv"

type ReleasePolicy = "safe" | "no_cuffs"

const KV_RELEASE_POLICY_KEY = "mode_release_policy"

function normalizePolicy(value: unknown): ReleasePolicy {
  return value === "safe" ? "safe" : "no_cuffs"
}

export function DialogReleaseButton() {
  const dialog = useDialog()
  const kv = useKV()
  const toast = useToast()

  onMount(() => dialog.setSize("medium"))

  const current = normalizePolicy(kv.get(KV_RELEASE_POLICY_KEY, "no_cuffs"))

  const options: DialogSelectOption<ReleasePolicy>[] = [
    {
      title: "Release (safe)",
      value: "safe",
      description: "Respect hold-mode safety rails like always_block.",
    },
    {
      title: "No cuffs (allow everything)",
      value: "no_cuffs",
      description: "Skip all checks (skipPermissions), including always_block.",
    },
  ]

  return (
    <DialogSelect
      title="Release Button"
      placeholder={undefined}
      options={options}
      current={current}
      skipFilter
      onSelect={(opt) => {
        kv.set(KV_RELEASE_POLICY_KEY, opt.value)
        toast.show({
          variant: "info",
          message: opt.value === "safe" ? "Release button set to SAFE" : "Release button set to NO CUFFS",
          duration: 2000,
        })
        dialog.clear()
      }}
    />
  )
}

