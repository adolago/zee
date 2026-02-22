import { describe, expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { buildPlanWebExecutionReminder } from "../../src/session/plan-web-execution"

function userMessage(text: string, id = "msg_user"): MessageV2.WithParts {
  return {
    info: {
      id,
      role: "user",
    },
    parts: [{ type: "text", text }],
  } as any
}

describe("session.plan-web-execution", () => {
  test("builds reminder for read-only web requests in plan mode", () => {
    const result = buildPlanWebExecutionReminder({
      messages: [userMessage("Search the web for the latest Bun test docs")],
      mode: "plan",
      surface: "cli",
    })

    expect(result).toBeDefined()
    expect(result!).toContain("[PLAN WEB EXECUTION]")
    expect(result!).toContain("Execute read-only web actions now using available tools")
    expect(result!).toContain("Do not reply with only instructions")
  })

  test("does not build reminder outside plan mode", () => {
    const result = buildPlanWebExecutionReminder({
      messages: [userMessage("Search the web for TypeScript docs")],
      mode: "accept",
      surface: "cli",
    })

    expect(result).toBeUndefined()
  })

  test("does not build reminder for non-web prompts", () => {
    const result = buildPlanWebExecutionReminder({
      messages: [userMessage("Explain this stack trace from my local build")],
      mode: "plan",
      surface: "cli",
    })

    expect(result).toBeUndefined()
  })

  test("includes accept-mode guidance for mutating web actions on cli", () => {
    const result = buildPlanWebExecutionReminder({
      messages: [userMessage("Log in and submit this form on the website")],
      mode: "plan",
      surface: "cli",
    })

    expect(result).toBeDefined()
    expect(result!).toContain("appears to include a mutating web action")
    expect(result!).toContain("switch to ACCEPT mode")
  })

  test("includes release guidance for mutating web actions on whatsapp", () => {
    const result = buildPlanWebExecutionReminder({
      messages: [userMessage("Buy this item online and complete checkout")],
      mode: "plan",
      surface: "whatsapp",
    })

    expect(result).toBeDefined()
    expect(result!).toContain("/release <PIN>")
  })
})
