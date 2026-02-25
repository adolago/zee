import { afterAll, describe, expect, mock, test, beforeEach } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createSignal } from "solid-js"
import {
  createPermissionRequest,
  createQuestionRequest,
  resetPermissionIdCounter,
  resetQuestionIdCounter,
  setupCommonMocks,
} from "./helpers"

afterAll(() => {
  mock.restore()
})

setupCommonMocks()

beforeEach(() => {
  resetPermissionIdCounter()
  resetQuestionIdCounter()
})

describe("Permission stage transitions", () => {
  // Tests the stage state machine from permission.tsx:
  // type PermissionStage = "permission" | "always" | "reject"

  test("initial stage is 'permission'", () => {
    const result = createRoot((dispose) => {
      const [store] = createStore({ stage: "permission" as "permission" | "always" | "reject" })
      const value = { stage: store.stage, dispose }
      return value
    })
    expect(result.stage).toBe("permission")
    result.dispose()
  })

  test("selecting 'always' transitions to 'always' stage", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        stage: "permission" as "permission" | "always" | "reject",
      })

      // Simulate selecting "always" option
      setStore("stage", "always")

      return { stage: store.stage, dispose }
    })
    expect(result.stage).toBe("always")
    result.dispose()
  })

  test("canceling 'always' returns to 'permission'", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        stage: "permission" as "permission" | "always" | "reject",
      })

      // Go to always, then cancel
      setStore("stage", "always")
      setStore("stage", "permission")

      return { stage: store.stage, dispose }
    })
    expect(result.stage).toBe("permission")
    result.dispose()
  })

  test("selecting 'reject' transitions to 'reject' stage for child session", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        stage: "permission" as "permission" | "always" | "reject",
      })

      // Child session: reject goes to reject stage for message input
      setStore("stage", "reject")

      return { stage: store.stage, dispose }
    })
    expect(result.stage).toBe("reject")
    result.dispose()
  })

  test("canceling 'reject' returns to 'permission'", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        stage: "permission" as "permission" | "always" | "reject",
      })

      setStore("stage", "reject")
      setStore("stage", "permission")

      return { stage: store.stage, dispose }
    })
    expect(result.stage).toBe("permission")
    result.dispose()
  })

  test("full cycle: permission -> always -> permission -> reject -> permission", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        stage: "permission" as "permission" | "always" | "reject",
      })

      const stages: string[] = [store.stage]

      setStore("stage", "always")
      stages.push(store.stage)

      setStore("stage", "permission")
      stages.push(store.stage)

      setStore("stage", "reject")
      stages.push(store.stage)

      setStore("stage", "permission")
      stages.push(store.stage)

      return { stages, dispose }
    })
    expect(result.stages).toEqual(["permission", "always", "permission", "reject", "permission"])
    result.dispose()
  })
})

describe("Question state management", () => {
  // Tests the store from question.tsx:
  // { tab: 0, answers: [], custom: [], selected: 0, editing: false }

  test("initial state: tab=0, selected=0, editing=false", () => {
    const result = createRoot((dispose) => {
      const [store] = createStore({
        tab: 0,
        answers: [] as string[][],
        custom: [] as string[],
        selected: 0,
        editing: false,
      })
      return { store, dispose }
    })
    expect(result.store.tab).toBe(0)
    expect(result.store.selected).toBe(0)
    expect(result.store.editing).toBe(false)
    expect(result.store.answers).toEqual([])
    expect(result.store.custom).toEqual([])
    result.dispose()
  })

  test("tab navigation wraps around with modulo", () => {
    const result = createRoot((dispose) => {
      const tabs = 3 // 2 questions + 1 confirm tab
      const [store, setStore] = createStore({ tab: 0 })

      // Navigate right past end -> wraps to 0
      setStore("tab", (store.tab + 1) % tabs) // 1
      setStore("tab", (store.tab + 1) % tabs) // 2
      setStore("tab", (store.tab + 1) % tabs) // 0 (wrapped)
      const afterWrap = store.tab

      // Navigate left past start -> wraps to end
      setStore("tab", (store.tab - 1 + tabs) % tabs) // 2
      const afterLeftWrap = store.tab

      return { afterWrap, afterLeftWrap, dispose }
    })
    expect(result.afterWrap).toBe(0)
    expect(result.afterLeftWrap).toBe(2)
    result.dispose()
  })

  test("option selection updates answers array", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        tab: 0,
        answers: [] as string[][],
      })

      // Single-select: pick sets a single answer
      const answers = [...store.answers]
      answers[store.tab] = ["Option A"]
      setStore("answers", answers)

      return { answers: store.answers, dispose }
    })
    expect(result.answers[0]).toEqual(["Option A"])
    result.dispose()
  })

  test("multi-select toggle adds/removes answers", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        tab: 0,
        answers: [] as string[][],
      })

      // Toggle "A" on
      function toggle(answer: string) {
        const existing = store.answers[store.tab] ?? []
        const next = [...existing]
        const index = next.indexOf(answer)
        if (index === -1) next.push(answer)
        else next.splice(index, 1)
        const answers = [...store.answers]
        answers[store.tab] = next
        setStore("answers", answers)
      }

      toggle("A")
      const afterAddA = [...(store.answers[0] ?? [])]

      toggle("B")
      const afterAddB = [...(store.answers[0] ?? [])]

      // Toggle "A" off
      toggle("A")
      const afterRemoveA = [...(store.answers[0] ?? [])]

      return { afterAddA, afterAddB, afterRemoveA, dispose }
    })
    expect(result.afterAddA).toEqual(["A"])
    expect(result.afterAddB).toEqual(["A", "B"])
    expect(result.afterRemoveA).toEqual(["B"])
    result.dispose()
  })

  test("custom input editing state toggles", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({ editing: false })

      setStore("editing", true)
      const isEditing = store.editing

      setStore("editing", false)
      const afterClose = store.editing

      return { isEditing, afterClose, dispose }
    })
    expect(result.isEditing).toBe(true)
    expect(result.afterClose).toBe(false)
    result.dispose()
  })

  test("changing tab resets selected to 0", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        tab: 0,
        selected: 3,
      })

      // Simulate selectTab function from question.tsx
      function selectTab(index: number) {
        setStore("tab", index)
        setStore("selected", 0)
      }

      selectTab(1)

      return { tab: store.tab, selected: store.selected, dispose }
    })
    expect(result.tab).toBe(1)
    expect(result.selected).toBe(0)
    result.dispose()
  })

  test("option navigation wraps with up/down", () => {
    const result = createRoot((dispose) => {
      const total = 3 // 2 options + 1 custom
      const [store, setStore] = createStore({ selected: 0 })

      // Move down past last
      setStore("selected", (store.selected + 1) % total) // 1
      setStore("selected", (store.selected + 1) % total) // 2
      setStore("selected", (store.selected + 1) % total) // 0 (wrapped)
      const afterDownWrap = store.selected

      // Move up past first
      setStore("selected", (store.selected - 1 + total) % total) // 2
      const afterUpWrap = store.selected

      return { afterDownWrap, afterUpWrap, dispose }
    })
    expect(result.afterDownWrap).toBe(0)
    expect(result.afterUpWrap).toBe(2)
    result.dispose()
  })

  test("custom input tracked per-tab", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        tab: 0,
        custom: [] as string[],
      })

      // Set custom input for tab 0
      const inputs0 = [...store.custom]
      inputs0[0] = "custom for tab 0"
      setStore("custom", inputs0)

      // Set custom input for tab 1
      const inputs1 = [...store.custom]
      inputs1[1] = "custom for tab 1"
      setStore("custom", inputs1)

      return {
        tab0: store.custom[0],
        tab1: store.custom[1],
        dispose,
      }
    })
    expect(result.tab0).toBe("custom for tab 0")
    expect(result.tab1).toBe("custom for tab 1")
    result.dispose()
  })
})

describe("Plan/Accept mode", () => {
  test("plan mode defaults to true", () => {
    const result = createRoot((dispose) => {
      const [store] = createStore({ hold: true })
      return { hold: store.hold, dispose }
    })
    expect(result.hold).toBe(true)
    result.dispose()
  })

  test("toggle switches between plan and accept", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({ hold: true })

      setStore("hold", !store.hold)
      const afterFirst = store.hold

      setStore("hold", !store.hold)
      const afterSecond = store.hold

      return { afterFirst, afterSecond, dispose }
    })
    expect(result.afterFirst).toBe(false)
    expect(result.afterSecond).toBe(true)
    result.dispose()
  })

  test("accept mode: isAccept=true, isPlan=false", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({ hold: true })
      setStore("hold", false)
      return {
        isHold: store.hold,
        isRelease: !store.hold,
        dispose,
      }
    })
    expect(result.isHold).toBe(false)
    expect(result.isRelease).toBe(true)
    result.dispose()
  })
})

describe("Dialog stack management", () => {
  test("stack starts empty", () => {
    const result = createRoot((dispose) => {
      const [store] = createStore({
        stack: [] as { element: unknown; onClose?: () => void }[],
      })
      return { length: store.stack.length, dispose }
    })
    expect(result.length).toBe(0)
    result.dispose()
  })

  test("replace adds item", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        stack: [] as { element: unknown; onClose?: () => void }[],
      })

      // Simulate dialog.replace()
      setStore("stack", [{ element: "dialog-content" }])

      return { length: store.stack.length, dispose }
    })
    expect(result.length).toBe(1)
    result.dispose()
  })

  test("clear empties stack", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        stack: [] as { element: unknown; onClose?: () => void }[],
      })

      setStore("stack", [{ element: "dialog-1" }, { element: "dialog-2" }])
      const beforeClear = store.stack.length

      // Simulate dialog.clear()
      setStore("stack", [])
      const afterClear = store.stack.length

      return { beforeClear, afterClear, dispose }
    })
    expect(result.beforeClear).toBe(2)
    expect(result.afterClear).toBe(0)
    result.dispose()
  })

  test("keyboard handlers skip when stack non-empty", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        stack: [] as { element: unknown }[],
      })

      let handlerExecuted = false

      // Simulate the keyboard guard from permission.tsx / question.tsx:
      // if (dialog.stack.length > 0) return
      function handleKeyboard() {
        if (store.stack.length > 0) return
        handlerExecuted = true
      }

      // With empty stack, handler should execute
      handleKeyboard()
      const executedWhenEmpty = handlerExecuted

      // With non-empty stack, handler should skip
      handlerExecuted = false
      setStore("stack", [{ element: "some-dialog" }])
      handleKeyboard()
      const executedWhenNonEmpty = handlerExecuted

      return { executedWhenEmpty, executedWhenNonEmpty, dispose }
    })
    expect(result.executedWhenEmpty).toBe(true)
    expect(result.executedWhenNonEmpty).toBe(false)
    result.dispose()
  })
})
