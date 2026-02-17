export type BufferedUpdater<T> = {
  push(item: T): void
  flushNow(): void
}

export function createBufferedUpdater<T>(opts: {
  key(item: T): string
  flushMs: number
  apply(items: T[]): void
}): BufferedUpdater<T> {
  const pending = new Map<string, T>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.size === 0) return
    const items = Array.from(pending.values())
    pending.clear()
    opts.apply(items)
  }

  return {
    push(item) {
      pending.set(opts.key(item), item)
      if (timer) return
      timer = setTimeout(flush, opts.flushMs)
    },
    flushNow() {
      flush()
    },
  }
}
