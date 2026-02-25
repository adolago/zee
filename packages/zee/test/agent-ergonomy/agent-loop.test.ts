import { afterAll, describe, expect, mock, test, beforeEach } from "bun:test"
import { createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSignal } from "solid-js"
import {
  createMockSDKClient,
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

// Helper: Binary.search equivalent for sorted arrays (matching sync.tsx logic)
function binarySearch<T>(arr: T[], id: string, getId: (item: T) => string) {
  let low = 0
  let high = arr.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (getId(arr[mid]) < id) low = mid + 1
    else high = mid
  }
  return {
    index: low,
    found: low < arr.length && getId(arr[low]) === id,
  }
}

describe("Permission approval loop", () => {
  test("full once cycle: request appears -> user approves -> request cleared", () => {
    const { client, tracker } = createMockSDKClient()

    const result = createRoot((dispose) => {
      const [store, setStore] = createStore<{
        permission: Record<string, Array<{ id: string; sessionID: string }>>
      }>({ permission: {} })

      // 1. Permission request arrives (simulating permission.asked event)
      const request = createPermissionRequest({ id: "perm-once-1", sessionID: "s1" })
      setStore("permission", "s1", [request])
      const afterAdd = store.permission["s1"]?.length ?? 0

      // 2. User approves with "once"
      client.permission.reply({
        reply: "once",
        requestID: request.id,
      })

      // 3. permission.replied event clears the request
      const requests = store.permission["s1"] ?? []
      const match = binarySearch(requests, request.id, (r) => r.id)
      if (match.found) {
        setStore(
          "permission",
          "s1",
          produce((draft) => {
            draft.splice(match.index, 1)
          }),
        )
      }
      const afterClear = store.permission["s1"]?.length ?? 0

      return { afterAdd, afterClear, dispose }
    })

    expect(result.afterAdd).toBe(1)
    expect(result.afterClear).toBe(0)
    expect(tracker.count("permission.reply")).toBe(1)
    expect(tracker.last("permission.reply")!.args[0]).toEqual({
      reply: "once",
      requestID: "perm-once-1",
    })
    result.dispose()
  })

  test("full always cycle: request -> always confirm -> cleared", () => {
    const { client, tracker } = createMockSDKClient()

    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        stage: "permission" as "permission" | "always" | "reject",
        permission: {} as Record<string, Array<{ id: string; sessionID: string }>>,
      })

      const request = createPermissionRequest({ id: "perm-always-1", sessionID: "s1" })
      setStore("permission", "s1", [request])

      // Stage 1: User selects "always" -> transitions to always confirmation
      setStore("stage", "always")
      const stageAfterSelect = store.stage

      // Stage 2: User confirms "always"
      setStore("stage", "permission") // reset stage
      client.permission.reply({
        reply: "always",
        requestID: request.id,
      })

      // Clear from store
      setStore("permission", "s1", [])
      const afterClear = store.permission["s1"]?.length ?? 0

      return { stageAfterSelect, afterClear, dispose }
    })

    expect(result.stageAfterSelect).toBe("always")
    expect(result.afterClear).toBe(0)
    expect(tracker.last("permission.reply")!.args[0]).toEqual({
      reply: "always",
      requestID: "perm-always-1",
    })
    result.dispose()
  })

  test("reject cycle with message in child session", () => {
    const { client, tracker } = createMockSDKClient()

    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        stage: "permission" as "permission" | "always" | "reject",
        permission: {} as Record<string, Array<{ id: string; sessionID: string }>>,
      })

      const request = createPermissionRequest({ id: "perm-reject-1", sessionID: "s1" })
      setStore("permission", "s1", [request])

      // Child session: reject goes to reject stage
      setStore("stage", "reject")

      // User types message and confirms
      client.permission.reply({
        reply: "reject",
        requestID: request.id,
        message: "Try a different file",
      })

      setStore("permission", "s1", [])

      return { stage: store.stage, dispose }
    })

    expect(tracker.last("permission.reply")!.args[0]).toEqual({
      reply: "reject",
      requestID: "perm-reject-1",
      message: "Try a different file",
    })
    result.dispose()
  })

  test("multiple sequential permissions processed in order", () => {
    const { client, tracker } = createMockSDKClient()

    const result = createRoot((dispose) => {
      const [store, setStore] = createStore<{
        permission: Record<string, Array<{ id: string; sessionID: string }>>
      }>({ permission: {} })

      // Add three permissions in order
      const req1 = createPermissionRequest({ id: "perm-seq-1", sessionID: "s1" })
      const req2 = createPermissionRequest({ id: "perm-seq-2", sessionID: "s1" })
      const req3 = createPermissionRequest({ id: "perm-seq-3", sessionID: "s1" })

      setStore("permission", "s1", [req1, req2, req3])
      const initialCount = store.permission["s1"]!.length

      // Process first (approve)
      client.permission.reply({ reply: "once", requestID: req1.id })
      setStore(
        "permission",
        "s1",
        produce((draft) => {
          draft.splice(0, 1)
        }),
      )
      const afterFirst = store.permission["s1"]!.length

      // Process second (approve)
      client.permission.reply({ reply: "once", requestID: req2.id })
      setStore(
        "permission",
        "s1",
        produce((draft) => {
          draft.splice(0, 1)
        }),
      )
      const afterSecond = store.permission["s1"]!.length

      // Process third (approve)
      client.permission.reply({ reply: "once", requestID: req3.id })
      setStore(
        "permission",
        "s1",
        produce((draft) => {
          draft.splice(0, 1)
        }),
      )
      const afterThird = store.permission["s1"]!.length

      return { initialCount, afterFirst, afterSecond, afterThird, dispose }
    })

    expect(result.initialCount).toBe(3)
    expect(result.afterFirst).toBe(2)
    expect(result.afterSecond).toBe(1)
    expect(result.afterThird).toBe(0)
    expect(tracker.count("permission.reply")).toBe(3)
    result.dispose()
  })
})

describe("Question answer loop", () => {
  test("single-select: pick -> immediate submit", () => {
    const { client, tracker } = createMockSDKClient()

    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        tab: 0,
        answers: [] as string[][],
        question: {} as Record<string, Array<{ id: string; sessionID: string }>>,
      })

      const request = createQuestionRequest({
        id: "q-loop-single",
        questions: [
          {
            question: "Pick one",
            header: "Choice",
            options: [
              { label: "A", description: "First" },
              { label: "B", description: "Second" },
            ],
          },
        ],
      })

      setStore("question", "session-1", [request])

      // Single-select: picking immediately submits
      const answers = [...store.answers]
      answers[0] = ["A"]
      setStore("answers", answers)

      client.question.reply({
        requestID: request.id,
        answers: [["A"]],
      })

      // Clear from store
      setStore("question", "session-1", [])
      const afterClear = store.question["session-1"]?.length ?? 0

      return { afterClear, dispose }
    })

    expect(result.afterClear).toBe(0)
    expect(tracker.count("question.reply")).toBe(1)
    expect(tracker.last("question.reply")!.args[0]).toEqual({
      requestID: "q-loop-single",
      answers: [["A"]],
    })
    result.dispose()
  })

  test("multi-select: toggle options -> confirm tab -> submit", () => {
    const { client, tracker } = createMockSDKClient()

    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        tab: 0,
        answers: [] as string[][],
      })

      const request = createQuestionRequest({
        id: "q-loop-multi",
        questions: [
          {
            question: "Select features",
            header: "Features",
            options: [
              { label: "A", description: "First" },
              { label: "B", description: "Second" },
              { label: "C", description: "Third" },
            ],
            multiple: true,
          },
        ],
      })

      // Toggle A on
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
      toggle("C")

      // Move to confirm tab and submit
      setStore("tab", 1) // confirm tab
      const finalAnswers = [store.answers[0] ?? []]

      client.question.reply({
        requestID: request.id,
        answers: finalAnswers,
      })

      return { finalAnswers, dispose }
    })

    expect(result.finalAnswers).toEqual([["A", "C"]])
    expect(tracker.last("question.reply")!.args[0]).toEqual({
      requestID: "q-loop-multi",
      answers: [["A", "C"]],
    })
    result.dispose()
  })

  test("reject cycle: escape dismisses", () => {
    const { client, tracker } = createMockSDKClient()

    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        question: {} as Record<string, Array<{ id: string; sessionID: string }>>,
      })

      const request = createQuestionRequest({ id: "q-loop-reject" })
      setStore("question", "session-1", [request])

      // User presses escape -> reject
      client.question.reject({ requestID: request.id })

      // question.rejected event clears from store
      setStore("question", "session-1", [])
      const afterClear = store.question["session-1"]?.length ?? 0

      return { afterClear, dispose }
    })

    expect(result.afterClear).toBe(0)
    expect(tracker.count("question.reject")).toBe(1)
    expect(tracker.last("question.reject")!.args[0]).toEqual({
      requestID: "q-loop-reject",
    })
    result.dispose()
  })
})

describe("Execution mode auto-approval", () => {
  test("accept mode auto-approves without user interaction", () => {
    const { client, tracker } = createMockSDKClient()

    const request = createPermissionRequest({ id: "perm-auto" })
    const isAccept = true

    // Simulate onMount behavior from permission.tsx
    if (isAccept) {
      client.permission.reply({
        reply: "once",
        requestID: request.id,
      })
    }

    expect(tracker.count("permission.reply")).toBe(1)
    expect(tracker.last("permission.reply")!.args[0]).toEqual({
      reply: "once",
      requestID: "perm-auto",
    })
  })

  test("plan mode does NOT auto-approve", () => {
    const { client, tracker } = createMockSDKClient()

    const request = createPermissionRequest({ id: "perm-hold" })
    const isAccept = false

    // onMount: only auto-approve if accept mode
    if (isAccept) {
      client.permission.reply({
        reply: "once",
        requestID: request.id,
      })
    }

    expect(tracker.count("permission.reply")).toBe(0)
  })

  test("mode switch does not retroactively approve pending permissions", () => {
    const { client, tracker } = createMockSDKClient()

    const result = createRoot((dispose) => {
      const [store, setStore] = createStore({
        hold: true,
        permission: {} as Record<string, Array<{ id: string; sessionID: string }>>,
      })

      // Permission arrives while in plan mode
      const request = createPermissionRequest({ id: "perm-pending" })
      setStore("permission", "session-1", [request])

      // onMount already ran with plan=true, so no auto-approve happened
      // Now switch to accept mode
      setStore("hold", false)

      // The existing permission should NOT be auto-approved just because mode changed
      // (onMount only runs once, on component mount)
      const stillPending = store.permission["session-1"]?.length ?? 0

      return { stillPending, dispose }
    })

    expect(result.stillPending).toBe(1)
    expect(tracker.count("permission.reply")).toBe(0)
    result.dispose()
  })
})

describe("Sync store event processing", () => {
  test("permission.asked adds request to store", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore<{
        permission: Record<string, Array<{ id: string; sessionID: string }>>
      }>({ permission: {} })

      // Simulate permission.asked event handler from sync.tsx
      const request = { id: "perm-asked-1", sessionID: "s1" }
      const requests = store.permission[request.sessionID]
      if (!requests) {
        setStore("permission", request.sessionID, [request])
      }

      return { count: store.permission["s1"]?.length ?? 0, dispose }
    })

    expect(result.count).toBe(1)
    result.dispose()
  })

  test("permission.replied removes request from store", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore<{
        permission: Record<string, Array<{ id: string; sessionID: string }>>
      }>({ permission: {} })

      // Add request
      setStore("permission", "s1", [{ id: "perm-replied-1", sessionID: "s1" }])
      const beforeRemove = store.permission["s1"]!.length

      // Simulate permission.replied event handler
      const requests = store.permission["s1"]!
      const match = binarySearch(requests, "perm-replied-1", (r) => r.id)
      if (match.found) {
        setStore(
          "permission",
          "s1",
          produce((draft) => {
            draft.splice(match.index, 1)
          }),
        )
      }
      const afterRemove = store.permission["s1"]!.length

      return { beforeRemove, afterRemove, dispose }
    })

    expect(result.beforeRemove).toBe(1)
    expect(result.afterRemove).toBe(0)
    result.dispose()
  })

  test("question.asked adds request to store", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore<{
        question: Record<string, Array<{ id: string; sessionID: string }>>
      }>({ question: {} })

      const request = { id: "q-asked-1", sessionID: "s1" }
      const requests = store.question[request.sessionID]
      if (!requests) {
        setStore("question", request.sessionID, [request])
      }

      return { count: store.question["s1"]?.length ?? 0, dispose }
    })

    expect(result.count).toBe(1)
    result.dispose()
  })

  test("question.replied removes request from store", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore<{
        question: Record<string, Array<{ id: string; sessionID: string }>>
      }>({ question: {} })

      setStore("question", "s1", [{ id: "q-replied-1", sessionID: "s1" }])
      const beforeRemove = store.question["s1"]!.length

      const requests = store.question["s1"]!
      const match = binarySearch(requests, "q-replied-1", (r) => r.id)
      if (match.found) {
        setStore(
          "question",
          "s1",
          produce((draft) => {
            draft.splice(match.index, 1)
          }),
        )
      }
      const afterRemove = store.question["s1"]!.length

      return { beforeRemove, afterRemove, dispose }
    })

    expect(result.beforeRemove).toBe(1)
    expect(result.afterRemove).toBe(0)
    result.dispose()
  })

  test("question.rejected removes request from store", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore<{
        question: Record<string, Array<{ id: string; sessionID: string }>>
      }>({ question: {} })

      setStore("question", "s1", [{ id: "q-rejected-1", sessionID: "s1" }])

      // Same removal logic as question.replied
      const requests = store.question["s1"]!
      const match = binarySearch(requests, "q-rejected-1", (r) => r.id)
      if (match.found) {
        setStore(
          "question",
          "s1",
          produce((draft) => {
            draft.splice(match.index, 1)
          }),
        )
      }
      const afterRemove = store.question["s1"]!.length

      return { afterRemove, dispose }
    })

    expect(result.afterRemove).toBe(0)
    result.dispose()
  })

  test("permissions across different sessions are isolated", () => {
    const result = createRoot((dispose) => {
      const [store, setStore] = createStore<{
        permission: Record<string, Array<{ id: string; sessionID: string }>>
      }>({ permission: {} })

      // Add permissions to different sessions
      setStore("permission", "s1", [
        { id: "perm-s1-1", sessionID: "s1" },
        { id: "perm-s1-2", sessionID: "s1" },
      ])
      setStore("permission", "s2", [{ id: "perm-s2-1", sessionID: "s2" }])

      const s1Count = store.permission["s1"]!.length
      const s2Count = store.permission["s2"]!.length

      // Remove from s1 only
      setStore(
        "permission",
        "s1",
        produce((draft) => {
          draft.splice(0, 1)
        }),
      )

      const s1After = store.permission["s1"]!.length
      const s2After = store.permission["s2"]!.length

      return { s1Count, s2Count, s1After, s2After, dispose }
    })

    expect(result.s1Count).toBe(2)
    expect(result.s2Count).toBe(1)
    expect(result.s1After).toBe(1)
    expect(result.s2After).toBe(1) // s2 unchanged
    result.dispose()
  })
})

describe("Mode change from tools", () => {
  test("tool with modeChange metadata triggers signal", () => {
    const result = createRoot((dispose) => {
      const [pendingModeChange, setPendingModeChange] = createSignal<"hold" | "release" | null>(null)

      // Simulate message.part.updated event with modeChange metadata
      const toolPart = {
        type: "tool",
        state: {
          status: "completed",
          metadata: { modeChange: "release" },
        },
      }

      if (toolPart.type === "tool" && toolPart.state.status === "completed") {
        const modeChange = toolPart.state.metadata?.modeChange
        if (modeChange === "hold" || modeChange === "release") {
          setPendingModeChange(modeChange)
        }
      }

      return { pending: pendingModeChange(), dispose }
    })

    expect(result.pending).toBe("release")
    result.dispose()
  })

  test("signal consumed after processing", () => {
    const result = createRoot((dispose) => {
      const [pendingModeChange, setPendingModeChange] = createSignal<"hold" | "release" | null>(null)

      // Set a pending mode change
      setPendingModeChange("hold")
      const before = pendingModeChange()

      // Consume the change (matching sync.tsx mode.consume())
      function consume() {
        const value = pendingModeChange()
        if (value) setPendingModeChange(null)
        return value
      }

      const consumed = consume()
      const after = pendingModeChange()

      return { before, consumed, after, dispose }
    })

    expect(result.before).toBe("hold")
    expect(result.consumed).toBe("hold")
    expect(result.after).toBeNull()
    result.dispose()
  })
})
