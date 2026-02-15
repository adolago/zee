import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import EXIT_DESCRIPTION from "./hold-release.txt"
import ENTER_DESCRIPTION from "./hold-enter.txt"

interface HoldModeMetadata {
  modeChange?: "plan" | "accept"
}

async function getLastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export const HoldReleaseTool = Tool.define<any, HoldModeMetadata>("hold_release", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const inAcceptMode = ctx.extra?.holdMode === false || session.mode === "accept" || session.mode === "bypass"
    if (inAcceptMode) {
      return {
        title: "Accept mode already active",
        output: "Already in accept mode. Continue with the task.",
        metadata: {},
      }
    }
    const plan = path.relative(Instance.worktree, Session.plan(session))
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Plan at ${plan} is complete. Would you like to switch to accept mode and start implementing?`,
          header: "Accept Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to accept mode and start implementing the plan" },
            { label: "No", description: "Stay in plan mode to continue refining the plan" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    // Persist mode change server-side (do not rely on the client to apply metadata).
    await Session.update(ctx.sessionID, (draft) => {
      draft.mode = "accept"
    })

    // Use current agent - plan/accept are modes, not separate agents
    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: ctx.agent, // Keep the current agent
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `The plan at ${plan} has been approved. Mode changed to ACCEPT - you can now edit files. Execute the plan.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to accept mode",
      output: "User approved switching to accept mode. You can now edit files. Continue with the plan.",
      metadata: { modeChange: "accept" },
    }
  },
})

export const HoldEnterTool = Tool.define<any, HoldModeMetadata>("hold_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const inPlanMode = ctx.extra?.holdMode === true || session.mode === "plan"
    if (inPlanMode) {
      return {
        title: "Plan mode already active",
        output: "Already in plan mode. Continue planning.",
        metadata: {},
      }
    }
    const plan = path.relative(Instance.worktree, Session.plan(session))

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to switch to plan mode and create a plan saved to ${plan}?`,
          header: "Plan Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to plan mode for research and planning" },
            { label: "No", description: "Stay in current mode to continue making changes" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]

    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    // Persist mode change server-side (do not rely on the client to apply metadata).
    await Session.update(ctx.sessionID, (draft) => {
      draft.mode = "plan"
    })

    // Use current agent - plan/accept are modes, not separate agents
    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: ctx.agent, // Keep the current agent
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: "Mode changed to PLAN (read-only). Begin planning and research without editing files.",
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to plan mode",
      output: `User confirmed to switch to plan mode. The plan file will be at ${plan}. Begin planning without editing files.`,
      metadata: { modeChange: "plan" },
    }
  },
})
