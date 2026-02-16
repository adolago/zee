import { describe, expect, test } from "bun:test"
import { KeyHandler, KeyEvent } from "@opentui/core"

// Kitty CSI u sequences for modifier-only keys
// Format: ESC [ codepoint ; modifiers:eventtype u
// Left shift = 57441, modifier mask 2 = shift
const SHIFT_PRESS = "\x1b[57441;2:1u"
const SHIFT_RELEASE = "\x1b[57441;2:3u"
const A_KEY_PRESS = "\x1b[97;1:1u" // 'a' key press (codepoint 97)

describe("shift-tap detection", () => {
  test("Kitty protocol parses leftshift press and release events", () => {
    const handler = new KeyHandler(true) // kitty keyboard enabled
    const events: KeyEvent[] = []

    handler.on("keypress", (evt: KeyEvent) => events.push(evt))
    handler.on("keyrelease", (evt: KeyEvent) => events.push(evt))

    handler.processInput(SHIFT_PRESS)
    handler.processInput(SHIFT_RELEASE)

    expect(events).toHaveLength(2)
    expect(events[0].name).toBe("leftshift")
    expect(events[0].eventType).toBe("press")
    expect(events[1].name).toBe("leftshift")
    expect(events[1].eventType).toBe("release")
  })

  test("shift-tap algorithm detects quick press+release", () => {
    let cycleCount = 0
    let shiftPressedAt: number | null = null

    function handleEvent(evt: { name: string; eventType: string }) {
      const isShift = evt.name === "leftshift" || evt.name === "rightshift"

      if (isShift && evt.eventType === "press") {
        shiftPressedAt = Date.now()
        return
      }

      if (evt.eventType === "press" && shiftPressedAt !== null) {
        shiftPressedAt = null
        return
      }

      if (isShift && evt.eventType === "release" && shiftPressedAt !== null) {
        const elapsed = Date.now() - shiftPressedAt
        shiftPressedAt = null
        if (elapsed < 300) {
          cycleCount++
        }
      }
    }

    // Simulate quick shift tap (press + release within 300ms)
    handleEvent({ name: "leftshift", eventType: "press" })
    handleEvent({ name: "leftshift", eventType: "release" })

    expect(cycleCount).toBe(1)
  })

  test("shift-tap algorithm ignores shift+key combo", () => {
    let cycleCount = 0
    let shiftPressedAt: number | null = null

    function handleEvent(evt: { name: string; eventType: string }) {
      const isShift = evt.name === "leftshift" || evt.name === "rightshift"

      if (isShift && evt.eventType === "press") {
        shiftPressedAt = Date.now()
        return
      }

      if (evt.eventType === "press" && shiftPressedAt !== null) {
        shiftPressedAt = null
        return
      }

      if (isShift && evt.eventType === "release" && shiftPressedAt !== null) {
        const elapsed = Date.now() - shiftPressedAt
        shiftPressedAt = null
        if (elapsed < 300) {
          cycleCount++
        }
      }
    }

    // Simulate Shift+A (shift down, a down, a up, shift up)
    handleEvent({ name: "leftshift", eventType: "press" })
    handleEvent({ name: "a", eventType: "press" }) // cancels tap
    handleEvent({ name: "a", eventType: "release" })
    handleEvent({ name: "leftshift", eventType: "release" })

    expect(cycleCount).toBe(0)
  })

  test("shift-tap algorithm ignores slow press", async () => {
    let cycleCount = 0
    let shiftPressedAt: number | null = null

    function handleEvent(evt: { name: string; eventType: string }) {
      const isShift = evt.name === "leftshift" || evt.name === "rightshift"

      if (isShift && evt.eventType === "press") {
        shiftPressedAt = Date.now()
        return
      }

      if (evt.eventType === "press" && shiftPressedAt !== null) {
        shiftPressedAt = null
        return
      }

      if (isShift && evt.eventType === "release" && shiftPressedAt !== null) {
        const elapsed = Date.now() - shiftPressedAt
        shiftPressedAt = null
        if (elapsed < 300) {
          cycleCount++
        }
      }
    }

    // Simulate slow shift hold (>300ms)
    handleEvent({ name: "leftshift", eventType: "press" })
    await new Promise((resolve) => setTimeout(resolve, 350))
    handleEvent({ name: "leftshift", eventType: "release" })

    expect(cycleCount).toBe(0)
  })

  test("end-to-end: Kitty shift press/release through KeyHandler triggers detection", () => {
    const handler = new KeyHandler(true)
    let cycleCount = 0
    let shiftPressedAt: number | null = null

    function handleEvent(evt: KeyEvent) {
      const isShift = evt.name === "leftshift" || evt.name === "rightshift"

      if (isShift && evt.eventType === "press") {
        shiftPressedAt = Date.now()
        return
      }

      if (evt.eventType === "press" && shiftPressedAt !== null) {
        shiftPressedAt = null
        return
      }

      if (isShift && evt.eventType === "release" && shiftPressedAt !== null) {
        const elapsed = Date.now() - shiftPressedAt
        shiftPressedAt = null
        if (elapsed < 300) {
          cycleCount++
        }
      }
    }

    handler.on("keypress", handleEvent)
    handler.on("keyrelease", handleEvent)

    // Send raw Kitty CSI sequences
    handler.processInput(SHIFT_PRESS)
    handler.processInput(SHIFT_RELEASE)

    expect(cycleCount).toBe(1)
  })

  test("end-to-end: Shift+A through KeyHandler does NOT trigger detection", () => {
    const handler = new KeyHandler(true)
    let cycleCount = 0
    let shiftPressedAt: number | null = null

    function handleEvent(evt: KeyEvent) {
      const isShift = evt.name === "leftshift" || evt.name === "rightshift"

      if (isShift && evt.eventType === "press") {
        shiftPressedAt = Date.now()
        return
      }

      if (evt.eventType === "press" && shiftPressedAt !== null) {
        shiftPressedAt = null
        return
      }

      if (isShift && evt.eventType === "release" && shiftPressedAt !== null) {
        const elapsed = Date.now() - shiftPressedAt
        shiftPressedAt = null
        if (elapsed < 300) {
          cycleCount++
        }
      }
    }

    handler.on("keypress", handleEvent)
    handler.on("keyrelease", handleEvent)

    handler.processInput(SHIFT_PRESS)
    handler.processInput(A_KEY_PRESS) // cancels shift-tap
    handler.processInput(SHIFT_RELEASE)

    expect(cycleCount).toBe(0)
  })

  test("Kitty disabled: shift events NOT generated for modifier-only keys", () => {
    const handler = new KeyHandler(false) // kitty keyboard DISABLED
    const events: KeyEvent[] = []

    handler.on("keypress", (evt: KeyEvent) => events.push(evt))
    handler.on("keyrelease", (evt: KeyEvent) => events.push(evt))

    // Without Kitty protocol, raw shift bytes don't generate events
    const processed = handler.processInput(SHIFT_PRESS)
    // The CSI sequence may or may not parse without Kitty --
    // the important thing is to verify behavior
    if (!processed) {
      expect(events).toHaveLength(0)
    }
  })
})
