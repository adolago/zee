import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"
import { HoldMode } from "@/config/hold-mode"

export const TodoWriteTool = Tool.define("todowrite", {
  description: DESCRIPTION_WRITE,
  parameters: z.object({
    todos: z.array(z.object(Todo.InfoInput.shape)).describe("The updated todo list"),
  }),
  async execute(params, ctx) {
    const holdMode = ctx.extra?.holdMode === true
    const skipPermissions = ctx.extra?.skipPermissions === true

    if (holdMode && !skipPermissions) {
      const allowed = await HoldMode.isToolAllowedInHold("todowrite", skipPermissions)
      if (!allowed) {
        throw new Error("HOLD MODE: Cannot modify todos. Switch to RELEASE mode to update todos.")
      }
    }

    await ctx.ask({
      permission: "todowrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    // Normalize todos - fills in defaults for status/priority and generates ids
    const normalizedTodos = params.todos.map(Todo.normalize)

    await Todo.update({
      sessionID: ctx.sessionID,
      todos: normalizedTodos,
    })
    return {
      title: `${normalizedTodos.filter((x) => x.status !== "completed").length} todos`,
      output: JSON.stringify(normalizedTodos, null, 2),
      metadata: {
        todos: normalizedTodos,
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
