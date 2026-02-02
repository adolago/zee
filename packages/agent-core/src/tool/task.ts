import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
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
 * Maps external agent types (e.g., from tiara orchestration) to personas.
 * Each persona spawns its own kind: zee spawns zees, stanley spawns stanleys, johny spawns johnys.
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

  // Check if the requested type exists directly
  const directAgent = await Agent.get(trimmed)
  if (directAgent) {
    return trimmed
  }

  // Map tiara/external agent types to personas based on the calling context
  // Each persona spawns its own kind for subtasks
  const personas = ["zee", "stanley", "johny"]

  // If caller is a persona, spawn the same persona type
  if (callerAgent && personas.includes(callerAgent)) {
    log.info("mapping external agent type to caller persona", {
      requestedType: trimmed,
      callerAgent,
      resolvedTo: callerAgent,
    })
    return callerAgent
  }

  // Semantic mapping for when there's no caller context
  // This maps tiara agent types to the most appropriate persona
  const semanticMap: Record<string, string> = {
    // Research/analysis → Stanley
    researcher: "stanley",
    analyst: "stanley",
    analyzer: "stanley",

    // Coding/development → Zee (general purpose)
    coder: "zee",
    developer: "zee",
    tester: "zee",
    architect: "zee",
    reviewer: "zee",
    optimizer: "zee",
    coordinator: "zee",
    general: "zee",

    // Learning/teaching → Johny
    tutor: "johny",
    teacher: "johny",
    mentor: "johny",
  }

  const mapped = semanticMap[trimmed.toLowerCase()]
  if (mapped) {
    log.info("semantic mapping for agent type", {
      requestedType: trimmed,
      resolvedTo: mapped,
    })
    return mapped
  }

  // Default to zee for unknown types
  log.info("unknown agent type, defaulting to zee", { requestedType: trimmed })
  return "zee"
}

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  session_id: z.string().describe("Existing Task session to continue").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
  timeout: z
    .number()
    .describe("Maximum execution time in milliseconds (default: 300000ms = 5 minutes)")
    .optional(),
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

  // Persona agents don't need the code-writing examples
  if (ctx?.agent?.native === true) {
    const exampleStart = description.indexOf("\nExample usage")
    if (exampleStart !== -1) {
      description = description.slice(0, exampleStart).trimEnd()
    }
  }

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // Resolve the agent type - maps tiara/external types to personas
      // Each persona spawns its own kind: zee→zee, stanley→stanley, johny→johny
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
      const parts: Record<string, { id: string; tool: string; state: { status: string; title?: string } }> = {}
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        if (evt.properties.part.type !== "tool") return
        const part = evt.properties.part
        parts[part.id] = {
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }
        ctx.metadata({
          title: params.description,
          metadata: {
            summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
            sessionId: session.id,
          },
        })
      })

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

        const output = text + "\n\n" + ["<task_metadata>", `session_id: ${session.id}`, "</task_metadata>"].join("\n")

        return {
          title: params.description,
          metadata: {
            summary,
            sessionId: session.id,
          },
          output,
        }
      } finally {
        unsub()
      }
    },
  }
})
