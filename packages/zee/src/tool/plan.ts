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
  modeChange?: "hold" | "release"
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
    const inReleaseMode = ctx.extra?.holdMode === false || session.mode === "release"
    if (inReleaseMode) {
      return {
        title: "Release mode already active",
        output: "Already in release mode. Continue with the task.",
        metadata: {},
      }
    }
    const plan = path.relative(Instance.worktree, Session.plan(session))
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Plan at ${plan} is complete. Would you like to switch to the release agent and start implementing?`,
          header: "Release Agent",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to release agent and start implementing the plan" },
            { label: "No", description: "Stay in hold mode to continue refining the plan" },
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
      draft.mode = "release"
    })

    // Use current agent - hold/release are modes, not separate agents
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
      text: `The plan at ${plan} has been approved. Mode changed to RELEASE - you can now edit files. Execute the plan.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to release mode",
      output: "User approved switching to release mode. You can now edit files. Continue with the plan.",
      metadata: { modeChange: "release" },
    }
  },
})

export const HoldEnterTool = Tool.define<any, HoldModeMetadata>("hold_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const inHoldMode = ctx.extra?.holdMode === true || session.mode === "hold"
    if (inHoldMode) {
      return {
        title: "Hold mode already active",
        output: "Already in hold mode. Continue planning.",
        metadata: {},
      }
    }
    const plan = path.relative(Instance.worktree, Session.plan(session))

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to switch to hold mode and create a plan saved to ${plan}?`,
          header: "Hold Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to hold mode for research and planning" },
            { label: "No", description: "Stay with release agent to continue making changes" },
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
      draft.mode = "hold"
    })

    // Use current agent - hold/release are modes, not separate agents
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
      text: "Mode changed to HOLD (read-only). Begin planning and research without editing files.",
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to hold mode",
      output: `User confirmed to switch to hold mode. The plan file will be at ${plan}. Begin planning without editing files.`,
      metadata: { modeChange: "hold" },
    }
  },
})
