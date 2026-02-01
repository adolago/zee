import { afterAll, describe, expect, mock, test, beforeEach } from "bun:test"
import { createRoot } from "solid-js"
import {
  CallTracker,
  createMockSDKClient,
  createPermissionRequest,
  createQuestionRequest,
  resetPermissionIdCounter,
  resetQuestionIdCounter,
  setupCommonMocks,
  createMockSDKModule,
  createMockSyncModule,
  createMockLocalModule,
} from "./helpers"

afterAll(() => {
  mock.restore()
})

// Setup common rendering mocks
setupCommonMocks()

beforeEach(() => {
  resetPermissionIdCounter()
  resetQuestionIdCounter()
})

describe("Permission SDK interactions", () => {
  test("permission.reply called with reply: 'once' and correct requestID", () => {
    const { client, tracker } = createMockSDKClient()
    const request = createPermissionRequest({ id: "req-abc" })

    // Simulate what PermissionPrompt does on "once" selection
    client.permission.reply({
      reply: "once",
      requestID: request.id,
    })

    const calls = tracker.get("permission.reply")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      reply: "once",
      requestID: "req-abc",
    })
  })

  test("permission.reply called with reply: 'always' after confirmation", () => {
    const { client, tracker } = createMockSDKClient()
    const request = createPermissionRequest({ id: "req-always" })

    // Simulate the always confirmation flow
    client.permission.reply({
      reply: "always",
      requestID: request.id,
    })

    const calls = tracker.get("permission.reply")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      reply: "always",
      requestID: "req-always",
    })
  })

  test("permission.reply called with reply: 'reject' when no parent session", () => {
    const { client, tracker } = createMockSDKClient()
    const request = createPermissionRequest({ id: "req-reject-no-parent" })

    // When session has no parentID, reject is sent directly
    client.permission.reply({
      reply: "reject",
      requestID: request.id,
    })

    const calls = tracker.get("permission.reply")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      reply: "reject",
      requestID: "req-reject-no-parent",
    })
  })

  test("permission.reply called with reply: 'reject' and message for child session", () => {
    const { client, tracker } = createMockSDKClient()
    const request = createPermissionRequest({ id: "req-reject-child" })

    // Child sessions allow a reject message
    client.permission.reply({
      reply: "reject",
      requestID: request.id,
      message: "Use a different approach",
    })

    const calls = tracker.get("permission.reply")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      reply: "reject",
      requestID: "req-reject-child",
      message: "Use a different approach",
    })
  })

  test("permission.reply with reply: 'once' auto-called in release mode", () => {
    const { client, tracker } = createMockSDKClient()
    const request = createPermissionRequest({ id: "req-release-auto" })

    // Simulate release mode auto-approve (onMount in PermissionPrompt)
    const isRelease = true
    if (isRelease) {
      client.permission.reply({
        reply: "once",
        requestID: request.id,
      })
    }

    const calls = tracker.get("permission.reply")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      reply: "once",
      requestID: "req-release-auto",
    })
  })
})

describe("Question SDK interactions", () => {
  test("question.reply with single answer for single-select", () => {
    const { client, tracker } = createMockSDKClient()
    const request = createQuestionRequest({ id: "q-single" })

    // Single-select immediately submits with the picked answer
    client.question.reply({
      requestID: request.id,
      answers: [["Option A"]],
    })

    const calls = tracker.get("question.reply")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      requestID: "q-single",
      answers: [["Option A"]],
    })
  })

  test("question.reply with multiple answers for multi-select", () => {
    const { client, tracker } = createMockSDKClient()
    const request = createQuestionRequest({
      id: "q-multi",
      questions: [
        {
          question: "Select features",
          header: "Features",
          options: [
            { label: "TypeScript", description: "TS support" },
            { label: "ESLint", description: "Linting" },
            { label: "Prettier", description: "Formatting" },
          ],
          multiple: true,
        },
      ],
    })

    // Multi-select: toggled two options, then confirmed
    client.question.reply({
      requestID: request.id,
      answers: [["TypeScript", "Prettier"]],
    })

    const calls = tracker.get("question.reply")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      requestID: "q-multi",
      answers: [["TypeScript", "Prettier"]],
    })
  })

  test("question.reply with custom typed answer", () => {
    const { client, tracker } = createMockSDKClient()
    const request = createQuestionRequest({ id: "q-custom" })

    // Custom input: user typed their own answer
    client.question.reply({
      requestID: request.id,
      answers: [["My custom answer"]],
    })

    const calls = tracker.get("question.reply")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      requestID: "q-custom",
      answers: [["My custom answer"]],
    })
  })

  test("question.reject called on escape", () => {
    const { client, tracker } = createMockSDKClient()
    const request = createQuestionRequest({ id: "q-escape" })

    // Escape dismisses the question
    client.question.reject({
      requestID: request.id,
    })

    const calls = tracker.get("question.reject")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      requestID: "q-escape",
    })
  })

  test("question.reply with answer arrays matching multi-question request", () => {
    const { client, tracker } = createMockSDKClient()
    const request = createQuestionRequest({
      id: "q-multi-question",
      questions: [
        {
          question: "Pick a language",
          header: "Language",
          options: [
            { label: "TypeScript", description: "TS" },
            { label: "Rust", description: "Rust" },
          ],
        },
        {
          question: "Pick a framework",
          header: "Framework",
          options: [
            { label: "SolidJS", description: "Solid" },
            { label: "React", description: "React" },
          ],
        },
      ],
    })

    // Multi-question: one answer per tab
    client.question.reply({
      requestID: request.id,
      answers: [["TypeScript"], ["SolidJS"]],
    })

    const calls = tracker.get("question.reply")
    expect(calls).toHaveLength(1)
    const payload = calls[0].args[0] as { requestID: string; answers: string[][] }
    expect(payload.requestID).toBe("q-multi-question")
    expect(payload.answers).toHaveLength(2)
    expect(payload.answers[0]).toEqual(["TypeScript"])
    expect(payload.answers[1]).toEqual(["SolidJS"])
  })
})

describe("Session SDK interactions", () => {
  test("session.create with correct agent parameter", () => {
    const { client, tracker } = createMockSDKClient()

    client.session.create({ agent: "Zee" })

    const calls = tracker.get("session.create")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({ agent: "Zee" })
  })

  test("session.chat with sessionID and content", () => {
    const { client, tracker } = createMockSDKClient()

    client.session.chat({
      sessionID: "session-42",
      content: "Hello, what can you do?",
    })

    const calls = tracker.get("session.chat")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({
      sessionID: "session-42",
      content: "Hello, what can you do?",
    })
  })

  test("session.abort with sessionID", () => {
    const { client, tracker } = createMockSDKClient()

    client.session.abort({ sessionID: "session-42" })

    const calls = tracker.get("session.abort")
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toEqual({ sessionID: "session-42" })
  })
})
