/**
 * Returns an iteration hook for in-process restart loops.
 * The first call is considered initial startup and does nothing.
 * Each subsequent call represents a restart iteration.
 */
export function createRestartIterationHook(
  onRestart: () => void | Promise<void>,
): () => Promise<boolean> {
  let isFirstIteration = true

  return async () => {
    if (isFirstIteration) {
      isFirstIteration = false
      return false
    }

    await onRestart()
    return true
  }
}
