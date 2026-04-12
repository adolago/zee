import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@zee/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"
import { ApplyPatchTool } from "./apply_patch"
import { ListSessionsTool, SendToSessionTool } from "./session-control"
import { FetchContentTool } from "./fetch_content"
import { GetSearchContentTool } from "./get_search_content"
import { Global } from "@/global"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  function ensureRuntimeEnv() {
    process.env.ZEE_ROOT ??= Global.Path.source
    process.env.ZEE_SOURCE ??= Global.Path.source
    process.env.ZEE_CONFIG_DIR ??= Global.Path.config
    process.env.ZEE_DATA_DIR ??= Global.Path.data
    process.env.ZEE_STATE_DIR ??= Global.Path.state
    process.env.ZEE_LOG_DIR ??= Global.Path.log
  }

  function isToolDefinition(value: unknown): value is ToolDefinition {
    if (!value || typeof value !== "object") return false
    const candidate = value as Partial<ToolDefinition>
    return (
      typeof candidate.description === "string" &&
      typeof candidate.execute === "function" &&
      !!candidate.args &&
      typeof candidate.args === "object"
    )
  }

  async function loadCustomToolFile(match: string, custom: Tool.Info[]) {
    const namespace = path.basename(match, path.extname(match))
    try {
      const mod = await import(match)
      for (const [id, def] of Object.entries(mod)) {
        const toolID = id === "default" ? namespace : `${namespace}_${id}`
        if (!isToolDefinition(def)) {
          log.warn("custom tool export is invalid; skipping", { tool: toolID, path: match })
          continue
        }
        custom.push(fromPlugin(toolID, def))
      }
    } catch (error) {
      log.warn("failed to load custom tool; skipping", {
        path: match,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export const state = Instance.state(async () => {
    ensureRuntimeEnv()
    const custom = [] as Tool.Info[]
    const glob = new Bun.Glob("{tool,tools}/*.{js,ts}")

    for (const dir of await Config.directories()) {
      for await (const match of glob.scan({
        cwd: dir,
        absolute: true,
        followSymlinks: true,
        dot: true,
      })) {
        await loadCustomToolFile(match, custom)
      }
    }

    const plugins = await Plugin.list().catch((error) => {
      log.warn("failed to load plugins; skipping plugin tools", {
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    })
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        if (!isToolDefinition(def)) {
          log.warn("plugin tool export is invalid; skipping", { tool: id })
          continue
        }
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        parameters: z.object(def.args),
        description: def.description,
        execute: async (args, ctx) => {
          const pluginCtx = {
            ...ctx,
            directory: Instance.directory,
            worktree: Instance.worktree,
          } as unknown as PluginToolContext
          const result = await def.execute(args as any, pluginCtx)
          const out = await Truncate.output(result, {}, initCtx?.agent)
          return {
            title: "",
            output: out.truncated ? out.content : result,
            metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
          }
        },
      }),
    }
  }

  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    const config = await Config.get()

    return [
      InvalidTool,
      ...(["app", "cli", "desktop"].includes(Flag.ZEE_CLIENT) ? [QuestionTool] : []),
      BashTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      ApplyPatchTool,
      TaskTool,
      FetchContentTool,
      WebFetchTool,
      GetSearchContentTool,
      TodoWriteTool,
      TodoReadTool,
      ListSessionsTool,
      SendToSessionTool,
      WebSearchTool,
      CodeSearchTool,
      SkillTool,
      LspTool,
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...custom,
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function get(id: string) {
    const tools = await all()
    return tools.find((t) => t.id === id)
  }

  export async function tools(
    model: {
      providerID: string
      modelID: string
    },
    agent?: Agent.Info,
  ) {
    const tools = await all()
    const result = await Promise.all(
      tools.map(async (t) => {
        using _ = log.time(t.id)
        return {
          id: t.id,
          ...(await t.init({ agent })),
        }
      }),
    )
    return result
  }
}
