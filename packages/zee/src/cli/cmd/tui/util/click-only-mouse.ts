export type ClickOnlyMouseHandlers = {
  onMouseDown?: () => void
  onMouseUp?: () => void
}

export function createClickOnlyMouseHandlers(input: {
  onPress?: () => void
  onRelease?: () => void
}): ClickOnlyMouseHandlers {
  const handlers: ClickOnlyMouseHandlers = {}

  if (input.onPress) {
    handlers.onMouseDown = input.onPress
  }

  if (input.onRelease) {
    handlers.onMouseUp = input.onRelease
  }

  return handlers
}
