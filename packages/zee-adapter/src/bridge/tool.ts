/**
 * Tool Bridge
 *
 * Translates OpenCode tool operations to zee format.
 */

import type {
  AdapterConfig,
  Tool,
  ToolResult,
  PermissionContext,
  ZeeToolResultPayload,
} from "../types"

const TOOL_MAPPING: Record<string, string> = {
  BashTool: "bash",
  EditTool: "edit",
  GlobTool: "glob",
  GrepTool: "grep",
  LSTool: "ls",
  ReadTool: "read",
  WriteTool: "write",
  MultiEditTool: "multiedit",
  WebFetchTool: "webfetch",
  WebSearchTool: "websearch",
  LSPTool: "lsp",
  CodeSearchTool: "codesearch",
  TaskTool: "task",
  TodoTool: "todo",
  PlanTool: "plan",
  PatchTool: "apply_patch",
}

const REVERSE_TOOL_MAPPING = Object.fromEntries(
  Object.entries(TOOL_MAPPING).map(([k, v]) => [v, k])
)

const PERMISSION_TOOLS = new Set(["BashTool", "EditTool", "WriteTool", "TaskTool"])

export class ToolBridge {
  private toolCache: Tool[] | null = null
  private baseUrl: string

  constructor(private config: AdapterConfig) {
    this.baseUrl = config.zeeUrl.replace(/\/$/, "")
  }

  async initialize(): Promise<void> {
    await this.list()
  }

  async list(): Promise<Tool[]> {
    if (this.toolCache) return this.toolCache

    const response = await this.fetch("/tool")

    this.toolCache = response.tools.map((t: { name: string; description: string; parameters: Record<string, unknown> }) => ({
      name: REVERSE_TOOL_MAPPING[t.name] || t.name,
      description: t.description,
      parameters: t.parameters,
    }))

    return this.toolCache!
  }

  async execute(name: string, params: unknown): Promise<ToolResult> {
    const zeeTool = TOOL_MAPPING[name] || name
    const transformedParams = this.transformToolParams(name, params)

    const response = await this.fetch("/tool/execute", {
      method: "POST",
      body: JSON.stringify({
        name: zeeTool,
        params: transformedParams,
      }),
    })

    return this.transformToolResult(response)
  }

  async validatePermission(
    tool: string,
    _context: PermissionContext
  ): Promise<boolean> {
    if (!PERMISSION_TOOLS.has(tool)) {
      return true
    }

    // Zee handles permissions internally
    return true
  }

  private transformToolParams(toolName: string, params: unknown): unknown {
    const p = params as Record<string, unknown>

    switch (toolName) {
      case "ReadTool":
        return {
          path: p.file_path,
          offset: p.offset,
          limit: p.limit,
        }
      case "BashTool":
        return {
          command: p.command,
          timeout: p.timeout_ms,
        }
      case "EditTool":
        return {
          path: p.file_path,
          old_str: p.old_string,
          new_str: p.new_string,
        }
      case "WriteTool":
        return {
          path: p.file_path,
          content: p.content,
        }
      case "GlobTool":
        return {
          pattern: p.pattern,
          path: p.path,
        }
      case "GrepTool":
        return {
          pattern: p.pattern,
          path: p.path,
          include: p.include,
        }
      default:
        return params
    }
  }

  private transformToolResult(result: ZeeToolResultPayload): ToolResult {
    return {
      success: result.success,
      output: result.output,
      error: result.error,
      duration_ms: result.duration,
    }
  }

  private async fetch(path: string, options?: RequestInit): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...this.config.authHeaders,
        ...options?.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`)
    }

    return response.json()
  }
}
