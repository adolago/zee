import { Ripgrep } from "../file/ripgrep"
import { Instance } from "../project/instance"
import { MCP } from "../mcp"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"
import PROMPT_ASTRA from "./prompt/gpt-astra.txt"
import PROMPT_META from "./prompt/meta.txt"

import PROMPT_CODEX from "./prompt/codex_header.txt"
import type { Provider } from "@/provider/provider"

export namespace SystemPrompt {
  export function header(providerID: string) {
    if (providerID.includes("anthropic")) return [PROMPT_ANTHROPIC_SPOOF.trim()]
    return []
  }

  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("muse")) {
      const name = model.api.id.includes("muse-glimmer") ? "Muse Glimmer" : "Muse Spark"
      return [PROMPT_META.replaceAll("{{MODEL_NAME}}", name)]
    }
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3")) {
      if (model.api.id.includes("gpt-6")) return [PROMPT_ASTRA]
      return [PROMPT_BEAST]
    }
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  /**
   * MCP server instructions for servers that contribute at least one tool
   * to this turn. toolIds are the resolved IDs from resolveTools(); both the
   * bare and the server-prefixed ID forms count (proxy IDs vary by collision
   * and async wrapping).
   */
  export async function mcp(toolIds: Iterable<string>) {
    const ids = toolIds instanceof Set ? toolIds : new Set(toolIds)
    const servers = await MCP.instructions()
    const visible = servers.filter((item) =>
      item.tools.some((tool) => {
        const prefixed = MCP.mcpToolId(item.name, tool)
        const sanitized = tool.replace(/[^a-zA-Z0-9_-]/g, "_")
        // Proxy IDs vary: bare on no collision, prefixed otherwise, with
        // numeric or _job_poll suffixes on top.
        return ids.has(prefixed) || ids.has(sanitized) || [...ids].some((id) => id.startsWith(`${prefixed}_`))
      }),
    )
    if (visible.length === 0) return undefined

    return [
      "<mcp_instructions>",
      ...visible.flatMap((item) => [
        `  <server name="${item.name}">`,
        ...item.instructions.split("\n").map((line) => `    ${line}`),
        "  </server>",
      ]),
      "</mcp_instructions>",
    ].join("\n")
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}.`,
        ``,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<files>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 200,
              })
            : ""
        }`,
        `</files>`,
      ].join("\n"),
    ]
  }
}
