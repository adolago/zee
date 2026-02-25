import { describe, expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { buildFollowupExecutionReminder, isShortAffirmativeReply } from "../../src/session/followup-execution"

function userMessage(text: string, id = "msg_user"): MessageV2.WithParts {
  return {
    info: {
      id,
      role: "user",
    },
    parts: [{ type: "text", text }],
  } as any
}

function assistantMessage(text: string, id = "msg_assistant"): MessageV2.WithParts {
  return {
    info: {
      id,
      role: "assistant",
    },
    parts: [{ type: "text", text }],
  } as any
}

describe("session.followup-execution", () => {
  test("detects short affirmative replies", () => {
    expect(isShortAffirmativeReply("Yes")).toBeTrue()
    expect(isShortAffirmativeReply("ok, do it")).toBeTrue()
    expect(isShortAffirmativeReply("sounds good")).toBeTrue()
    expect(isShortAffirmativeReply("No, not now")).toBeFalse()
  })

  test("builds execution reminder for affirmative follow-up in whatsapp plan mode", () => {
    const result = buildFollowupExecutionReminder({
      messages: [
        userMessage("Turn off the living room lights", "msg_user_1"),
        assistantMessage(
          "Before I trigger anything in Home Assistant, quick confirmation: should I turn off all living room lights? If yes, reply with yes.",
          "msg_assistant_1",
        ),
        userMessage("Yes", "msg_user_2"),
      ],
      mode: "plan",
      surface: "whatsapp",
    })

    expect(result).toBeDefined()
    expect(result!).toContain("[FOLLOW-UP EXECUTION]")
    expect(result!).toContain("Treat this as approval and execute the pending action now using available tools.")
    expect(result!).toContain("/accept <PIN>")
  })

  test("does not build reminder when prior assistant text is not an action confirmation", () => {
    const result = buildFollowupExecutionReminder({
      messages: [
        userMessage("what's the weather", "msg_user_1"),
        assistantMessage("Do you also want humidity details?", "msg_assistant_1"),
        userMessage("yes", "msg_user_2"),
      ],
      mode: "accept",
      surface: "whatsapp",
    })

    expect(result).toBeUndefined()
  })
})
