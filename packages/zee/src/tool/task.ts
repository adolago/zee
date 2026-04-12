import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { Log } from "../util/log"

const log = Log.create({ service: "task" })

/**
 * Maps external agent types to canonical Zee runtime agents.
 * Scoped subagents remain distinct while domain-specialty aliases route to Zee.
 * @exported for use in prompt.ts subtask handling
 */
export async function resolveAgentType(requestedType: string, callerAgent?: string): Promise<string> {
  // If empty or whitespace, use caller's agent type
  const trimmed = requestedType?.trim()
  if (!trimmed) {
    if (callerAgent) {
      log.info("empty agent type, using caller agent", { callerAgent })
      return callerAgent
    }
    // Fall back to default agent
    return Agent.defaultAgent()
  }

  const requested = trimmed.toLowerCase()

  const semanticMap: Record<string, string> = {
    // Scoped subagent modes (read-only / limited scope)
    explore: "explore",
    finder: "finder",
    scout: "finder",
    searcher: "finder",
    explorer: "finder",
    librarian: "librarian",
    archive: "librarian",
    plan: "plan",
    general: "general",
    "general-purpose": "general",

    // Unified assistant handles research and learning directly now.
    researcher: "zee",
    analyst: "zee",
    analyzer: "zee",
    investing: "zee",
    investor: "zee",
    learning: "zee",
    learner: "zee",

    // Coding/development → Zee (general purpose)
    coder: "zee",
    developer: "zee",
    tester: "zee",
    architect: "zee",
    reviewer: "zee",
    optimizer: "zee",
    coordinator: "zee",

    // Learning/teaching also routes through Zee.
    tutor: "zee",
    teacher: "zee",
    mentor: "zee",
  }

  // Check requested type against explicit agent names (case-insensitive)
  const directAgent = await Agent.get(trimmed)
  if (directAgent) {
    return directAgent.name
  }
  const directAgentLower = await Agent.get(requested)
  if (directAgentLower) {
    return directAgentLower.name
  }

  const mapped = semanticMap[requested]
  if (mapped) {
    log.info("semantic mapping for agent type", {
      requestedType: trimmed,
      requestedLower: requested,
      resolvedTo: mapped,
    })
    return mapped
  }

  const caller = callerAgent ? await Agent.get(callerAgent) : undefined
  if (caller && caller.mode === "primary") {
    log.info("mapping external agent type to caller agent", {
      requestedType: trimmed,
      callerAgent,
      resolvedTo: caller.name,
    })
    return caller.name
  }

  // Default to zee for unknown types
  log.info("unknown agent type, defaulting to zee", { requestedType: trimmed })
  return "zee"
}

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  session_id: z
    .string()
    .describe("Set this to resume a previous subagent session instead of creating a fresh one")
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
  timeout: z.number().describe("Maximum execution time in milliseconds (default: 300000ms = 5 minutes)").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  let description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // Resolve the requested type to a canonical Zee runtime agent/subagent.
      const resolvedAgentType = await resolveAgentType(params.subagent_type, ctx.agent)

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [resolvedAgentType],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: resolvedAgentType,
            originalType: params.subagent_type !== resolvedAgentType ? params.subagent_type : undefined,
          },
        })
      }

      const agent = await Agent.get(resolvedAgentType)
      if (!agent) {
        // This shouldn't happen after resolution, but provide a helpful error
        const available = await Agent.list().then((agents) => agents.map((a) => a.name).join(", "))
        throw new Error(
          `Failed to resolve agent type: "${params.subagent_type}" → "${resolvedAgentType}". Available agents: ${available}`,
        )
      }

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

      const session = await iife(async () => {
        if (params.session_id) {
          const found = await Session.get(params.session_id).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
        },
      })

      const messageID = Identifier.ascending("message")

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      try {
        function cancel() {
          SessionPrompt.cancel(session.id)
        }
        ctx.abort.addEventListener("abort", cancel)
        // Check if already aborted AFTER adding listener to avoid race condition
        // where abort happens between listener add and this check
        if (ctx.abort.aborted) {
          cancel()
          throw ctx.abort.reason ?? new DOMException("Task aborted", "AbortError")
        }
        using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
        const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

        const timeoutMs = params.timeout ?? 300000 // 5 minute default
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs),
        )

        const result = await Promise.race([
          SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: agent.name,
            options: agent.options,
            tools: {
              todowrite: false,
              todoread: false,
              ...(hasTaskPermission ? {} : { task: false }),
              ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
            },
            parts: promptParts,
          }),
          timeoutPromise,
        ]).catch((error) => {
          SessionPrompt.cancel(session.id)
          throw error
        })

        const messages = await Session.messages({ sessionID: session.id })
        const summary = messages
          .filter((x) => x.info.role === "assistant")
          .flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])
          .map((part) => ({
            id: part.id,
            tool: part.tool,
            state: {
              status: part.state.status,
              title: part.state.status === "completed" ? part.state.title : undefined,
            },
          }))
        const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

        const output = [
          `session_id: ${session.id}`,
          "",
          "<task_result>",
          text,
          "</task_result>",
        ].join("\n")

        return {
          title: params.description,
          metadata: {
            summary,
            sessionId: session.id,
          },
          output,
        }
      } finally {
        // Streaming summary removed; TUI reads live parts from sync data
      }
    },
  }
})
