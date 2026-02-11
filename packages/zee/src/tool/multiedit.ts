import z from "zod"
import { Tool } from "./tool"
import { EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"
import { HoldMode } from "@/config/hold-mode"

export const MultiEditTool = Tool.define("multiedit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    edits: z
      .array(
        z.object({
          filePath: z.string().describe("The absolute path to the file to modify"),
          oldString: z.string().describe("The text to replace"),
          newString: z.string().describe("The text to replace it with (must be different from oldString)"),
          replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
        }),
      )
      .describe("Array of edit operations to perform sequentially on the file"),
  }),
  async execute(params, ctx) {
    const holdMode = ctx.extra?.holdMode === true
    const skipPermissions = ctx.extra?.skipPermissions === true

    if (holdMode && !skipPermissions) {
      const allowed = await HoldMode.isToolAllowedInHold("edit", skipPermissions)
      if (!allowed) {
        throw new Error("HOLD MODE: Cannot edit files. Switch to RELEASE mode to modify files.")
      }
    }

    const tool = await EditTool.init()
    const results = []
    for (const [, edit] of params.edits.entries()) {
      const result = await tool.execute(
        {
          filePath: params.filePath,
          oldString: edit.oldString,
          newString: edit.newString,
          replaceAll: edit.replaceAll,
        },
        ctx,
      )
      results.push(result)
    }
    const lastResult = results.at(-1)
    return {
      title: path.relative(Instance.worktree, params.filePath),
      metadata: {
        results: results.map((r) => r.metadata),
      },
      output: lastResult?.output ?? "",
    }
  },
})
