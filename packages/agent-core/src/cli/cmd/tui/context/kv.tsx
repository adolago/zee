import { Global } from "@/global"
import { createSignal, onCleanup, type Setter } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import path from "path"
import fsSync from "fs"

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<Record<string, any>>()
    const kvPath = path.join(Global.Path.state, "kv.json")
    const file = Bun.file(kvPath)

    let reloadTimer: ReturnType<typeof setTimeout> | undefined
    async function reloadFromDisk() {
      try {
        const next = await file.json()
        if (next && typeof next === "object") {
          setStore(next as Record<string, any>)
        }
      } catch {
        // Ignore invalid JSON / missing file
      }
    }

    file
      .json()
      .then((x) => {
        setStore(x)
      })
      .catch(() => {})
      .finally(() => {
        setReady(true)
      })

    // Keep KV in sync with external writers (e.g., Zee tools writing to kv.json)
    let watcher: fsSync.FSWatcher | undefined
    try {
      watcher = fsSync.watch(Global.Path.state, { persistent: false }, (_eventType, filename) => {
        if (filename && filename !== "kv.json") return
        if (reloadTimer) clearTimeout(reloadTimer)
        reloadTimer = setTimeout(() => {
          reloadFromDisk()
        }, 50)
      })
    } catch {
      // fs.watch may fail on some platforms/filesystems; KV still works without live reload
    }

    onCleanup(() => {
      if (reloadTimer) clearTimeout(reloadTimer)
      watcher?.close()
    })

    const result = {
      get ready() {
        return ready()
      },
      get store() {
        return store
      },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue)
        return [
          function () {
            return result.get(name)
          },
          function setter(next: Setter<T>) {
            result.set(name, next)
          },
        ] as const
      },
      get(key: string, defaultValue?: any) {
        return store[key] ?? defaultValue
      },
      set(key: string, value: any) {
        setStore(key, value)
        Bun.write(file, JSON.stringify(store, null, 2)).catch(() => {})
      },
    }
    return result
  },
})
