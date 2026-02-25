import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

export const TodoWriteTool = Tool.define("todowrite", {
  description: DESCRIPTION_WRITE,
  parameters: z.object({
    todos: z.array(z.object(Todo.InfoInput.shape)).describe("The updated todo list"),
    sessionId: z
      .string()
      .optional()
      .describe(
        "Optional session ID to write todos to. When omitted, writes to the current session. Use this to update or clear todos from other sessions (e.g. stale banner items).",
      ),
  }),
  async execute(params, ctx) {
    if (ctx.extra?.mode === "plan") {
      throw new Error("PLAN mode: Cannot modify todos. Switch to ACCEPT or BYPASS mode to update todos.")
    }

    await ctx.ask({
      permission: "todowrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    // Normalize todos - fills in defaults for status/priority and generates ids
    const normalizedTodos = params.todos.map(Todo.normalize)

    const targetSessionID = params.sessionId ?? ctx.sessionID

    await Todo.update({
      sessionID: targetSessionID,
      todos: normalizedTodos,
    })
    return {
      title: `${normalizedTodos.filter((x) => x.status !== "completed").length} todos`,
      output: JSON.stringify(normalizedTodos, null, 2),
      metadata: {
        todos: normalizedTodos,
        ...(params.sessionId ? { targetSessionId: params.sessionId } : {}),
      },
    }
  },
})

export const TodoReadTool = Tool.define("todoread", {
  description: "Use this tool to read your todo list",
  parameters: z.object({}),
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "todoread",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const todos = await Todo.get(ctx.sessionID)
    return {
      title: `${todos.filter((x) => x.status !== "completed").length} todos`,
      metadata: {
        todos,
      },
      output: JSON.stringify(todos, null, 2),
    }
  },
})
