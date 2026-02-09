import { createSignal, onCleanup } from "solid-js"

const TICK_INTERVAL = 120

const [tick, setTick] = createSignal(0)
let refCount = 0
let intervalId: ReturnType<typeof setInterval> | null = null

export function useAnimationTick() {
  if (refCount === 0) {
    intervalId = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL)
  }
  refCount++

  onCleanup(() => {
    refCount--
    if (refCount === 0 && intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  })

  return tick
}
