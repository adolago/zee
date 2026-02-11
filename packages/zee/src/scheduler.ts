import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

export namespace Scheduler {
  export type Scope = "instance" | "global"

  export type Task = {
    id: string
    interval: number
    run: () => void | Promise<void>
    scope?: Scope
  }

  type Entry = {
    task: Task
    timer?: ReturnType<typeof setInterval>
    running: boolean
    runner: () => Promise<void>
  }

  const log = Log.create({ service: "scheduler" })

  const getInstanceRegistry = Instance.state(
    () => new Map<string, Entry>(),
    async (registry) => {
      for (const entry of registry.values()) {
        if (entry.timer) clearInterval(entry.timer)
      }
      registry.clear()
    },
  )

  const globalRegistry = new Map<string, Entry>()

  /**
   * Reset the global registry (for testing)
   */
  export function resetGlobal() {
    for (const entry of globalRegistry.values()) {
      if (entry.timer) clearInterval(entry.timer)
    }
    globalRegistry.clear()
  }

  function schedule(entry: Entry) {
    const run = async () => {
      if (entry.running) return
      entry.running = true
      try {
        await entry.runner()
      } catch (error) {
        log.error("task failed", { id: entry.task.id, error })
      } finally {
        entry.running = false
      }
    }

    void run()

    if (entry.task.interval > 0) {
      entry.timer = setInterval(run, entry.task.interval)
      entry.timer.unref?.()
    }
  }

  export function register(task: Task) {
    const scope = task.scope ?? "instance"
    if (scope === "global") {
      if (globalRegistry.has(task.id)) return
      const entry: Entry = {
        task,
        running: false,
        runner: async () => {
          await task.run()
        },
      }
      globalRegistry.set(task.id, entry)
      schedule(entry)
      return
    }

    const registry = getInstanceRegistry()
    if (registry.has(task.id)) return
    const directory = Instance.directory
    const entry: Entry = {
      task,
      running: false,
      runner: async () => {
        await Instance.provide({ directory, fn: task.run })
      },
    }
    registry.set(task.id, entry)
    schedule(entry)
  }
}
