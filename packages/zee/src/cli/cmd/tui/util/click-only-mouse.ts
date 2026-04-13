import type { MouseEvent } from "@opentui/core"

export type ClickOnlyMouseHandlers = {
  onMouseDown?: (event: MouseEvent) => void
  onMouseUp?: (event: MouseEvent) => void
}

function isPrimaryClickEvent(event: MouseEvent, expectedType: "down" | "up"): boolean {
  return (
    event.type === expectedType &&
    event.button === 0 &&
    !event.isSelecting &&
    !event.defaultPrevented
  )
}

export function createClickOnlyMouseHandlers(input: {
  onPress?: () => void
  onRelease?: () => void
}): ClickOnlyMouseHandlers {
  const handlers: ClickOnlyMouseHandlers = {}
  let pressed = false

  if (input.onPress || input.onRelease) {
    handlers.onMouseDown = (event) => {
      if (!isPrimaryClickEvent(event, "down")) return
      pressed = true
      input.onPress?.()
    }
  }

  if (input.onRelease) {
    handlers.onMouseUp = (event) => {
      const wasPressed = pressed
      pressed = false
      if (!wasPressed || !isPrimaryClickEvent(event, "up")) return
      input.onRelease?.()
    }
  }

  return handlers
}
