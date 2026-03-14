import os from "os"
import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  streamText,
  wrapLanguageModel,
  simulateStreamingMiddleware,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  tool,
  jsonSchema,
} from "ai"
import { clone, mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"
import { generateAwarenessSection } from "../../../../src/awareness"
import { AppDeps } from "@/app/deps"
import { FluxRecorder } from "@/flux"

export namespace LLM {
  const log = Log.create({ service: "llm" })

  export const OUTPUT_TOKEN_MAX = Flag.ZEE_OUTPUT_TOKEN_MAX || 32_000
  const XAI_SCHEMA_MAX = 20_000
  const XAI_TOOL_MAX = 40

  function isXaiModel(model: Provider.Model) {
    const id = `${model.providerID}/${model.id}`.toLowerCase()
    return model.providerID === "xai" || model.api.npm === "@ai-sdk/xai" || id.includes("grok")
  }

  function xaiToolBytes(id: string, tool: Tool) {
    const schema = tool.inputSchema as { jsonSchema?: unknown }
    return new TextEncoder().encode(
      JSON.stringify({
        type: "function",
        function: {
          name: id,
          description: tool.description,
          parameters: schema.jsonSchema ?? {},
        },
      }),
    ).length
  }

  export function prepareTools(input: {
    model: Provider.Model
    tools: Record<string, Tool>
    toolChoice?: "auto" | "required"
  }) {
    const all = Object.keys(input.tools).filter((id) => id !== "invalid" && id !== "_noop")
    const cap = (() => {
      const value = (input.model.limit as Record<string, unknown>)["tools"]
      return typeof value === "number" ? value : undefined
    })()

    let active = all
    if (cap && active.length > cap) {
      active = active.slice(0, cap)
    }

    if (isXaiModel(input.model) && active.length > 0) {
      if (active.length > XAI_TOOL_MAX) {
        active = active.slice(0, XAI_TOOL_MAX)
      }

      const sized = active.map((id) => ({ id, bytes: xaiToolBytes(id, input.tools[id]!) }))
      let total = sized.reduce((sum, item) => sum + item.bytes, 0)
      if (total > XAI_SCHEMA_MAX) {
        const keep = [...sized]
        for (const item of [...sized].sort((a, b) => b.bytes - a.bytes)) {
          if (total <= XAI_SCHEMA_MAX || keep.length <= 1) break
          const index = keep.findIndex((entry) => entry.id === item.id)
          if (index < 0) continue
          keep.splice(index, 1)
          total -= item.bytes
        }
        active = keep.map((item) => item.id)
        if (total > XAI_SCHEMA_MAX && input.toolChoice !== "required") {
          active = []
        }
      }
    }

    if (!isXaiModel(input.model)) {
      return {
        active,
        tools: input.tools,
      }
    }

    const keep = new Set(active)
    if (input.tools["invalid"]) keep.add("invalid")
    if (input.tools["_noop"] && active.length > 0) keep.add("_noop")

    return {
      active,
      tools: Object.fromEntries(Object.entries(input.tools).filter(([id]) => keep.has(id))),
    }
  }

  function isUsageV3Shape(usage: any): boolean {
    return (
      !!usage &&
      typeof usage === "object" &&
      !!usage.inputTokens &&
      typeof usage.inputTokens === "object" &&
      "total" in usage.inputTokens &&
      !!usage.outputTokens &&
      typeof usage.outputTokens === "object" &&
      "total" in usage.outputTokens
    )
  }

  // Normalize legacy usage shapes to the V3 usage schema expected by ai v6.
  function normalizeUsage(usage: any) {
    if (isUsageV3Shape(usage)) return usage

    const inputTotal = typeof usage?.inputTokens === "number" ? usage.inputTokens : undefined
    const outputTotal = typeof usage?.outputTokens === "number" ? usage.outputTokens : undefined
    const cachedInput = typeof usage?.cachedInputTokens === "number" ? usage.cachedInputTokens : undefined
    const reasoning = typeof usage?.reasoningTokens === "number" ? usage.reasoningTokens : undefined

    const noCache =
      typeof inputTotal === "number"
        ? typeof cachedInput === "number"
          ? Math.max(0, inputTotal - cachedInput)
          : inputTotal
        : undefined
    const textTokens =
      typeof outputTotal === "number"
        ? typeof reasoning === "number"
          ? Math.max(0, outputTotal - reasoning)
          : outputTotal
        : undefined

    return {
      inputTokens: {
        total: inputTotal,
        noCache,
        cacheRead: cachedInput,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: outputTotal,
        text: textTokens,
        reasoning,
      },
      raw: usage?.raw,
    }
  }

  function normalizeStreamPart(part: any) {
    if (!part || part.type !== "finish") return part
    return { ...part, usage: normalizeUsage(part.usage) }
  }

  function resolveModelParam(
    param: "temperature" | "topP" | "topK" | "frequencyPenalty" | "presencePenalty",
    agent: Agent.Info,
    model: Provider.Model,
  ): number | undefined {
    if (agent.modelParams) {
      const modelId = model.id.toLowerCase()
      for (const [pattern, params] of Object.entries(agent.modelParams)) {
        const matches = pattern.split("|").some((p) => modelId.includes(p.trim()))
        if (matches) {
          if (params === null) return undefined // locked params (e.g. GPT-5)
          // When a modelParams entry matches, it is authoritative for this model.
          // Params not explicitly set in the entry fall through to provider defaults,
          // NOT to the agent's static params. This prevents e.g. agent.topP leaking
          // into providers that forbid combining temp + topP (Opus, Grok, GLM).
          if (params[param] !== undefined) return params[param]
          switch (param) {
            case "temperature":
              return ProviderTransform.temperature(model)
            case "topP":
              return ProviderTransform.topP(model)
            case "topK":
              return ProviderTransform.topK(model)
            default:
              return undefined
          }
        }
      }
    }
    // No modelParams match -- fall back to agent-level static params
    if (agent[param] !== undefined) return agent[param]
    // Fall back to provider defaults
    switch (param) {
      case "temperature":
        return ProviderTransform.temperature(model)
      case "topP":
        return ProviderTransform.topP(model)
      case "topK":
        return ProviderTransform.topK(model)
      default:
        return undefined
    }
  }

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    toolChoice?: "auto" | "required"
  }

  export type StreamOutput = StreamTextResult<ToolSet, any>

  export async function stream(input: StreamInput) {
    const deps = AppDeps.use()
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
      hasAgentPrompt: !!input.agent.prompt,
      agentPromptLength: input.agent.prompt?.length ?? 0,
      agentName: input.agent.name,
    })
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
    const traceID = input.user.id ?? input.sessionID
    const requestID = crypto.randomUUID()
    FluxRecorder.record({
      traceID,
      requestID,
      sessionID: input.sessionID,
      messageID: input.user.id,
      providerID: input.model.providerID,
      modelID: input.model.id,
      direction: "outbound",
      domain: "provider",
      kind: "api.outbound.request",
      status: "ok",
      metadata: {
        stream: true,
        small: input.small ?? false,
      },
    })
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    const system = SystemPrompt.header(input.model.providerID)

    // Generate awareness section for the active agent (tool catalog, config state, knowledge)
    let awarenessSection = ""
    try {
      awarenessSection = await generateAwarenessSection(input.agent)
    } catch (e) {
      l.warn("Failed to generate awareness section", { error: e })
    }

    system.push(
      [
        // use agent prompt otherwise provider prompt
        // For Codex sessions, skip SystemPrompt.provider() since it's sent via options.instructions
        ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
        // Agent-specific system prompt additions from bootstrap/config
        ...(input.agent.systemPromptAdditions ? [input.agent.systemPromptAdditions] : []),
        // Dynamic awareness section (tool catalog, enabled services)
        ...(awarenessSection ? [awarenessSection] : []),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    const original = clone(system)
    // For Anthropic: system[0] is header, system[1] is content
    // For others: system[0] is content (no separate header)
    const mainContent = system.length > 1 ? system[1] : system[0]
    // Enhanced logging for agent prompt debugging.
    l.info("system prompt constructed", {
      systemParts: system.length,
      headerLength: header?.length ?? 0,
      mainContentLength: mainContent?.length ?? 0,
      agentPromptLength: input.agent.prompt?.length ?? 0,
      agentPromptPreview: input.agent.prompt?.slice(0, 100) ?? "(no prompt)",
      includesAgentPrompt: input.agent.prompt ? mainContent?.includes(input.agent.prompt.slice(0, 50)) : false,
      systemContentPreview: mainContent?.slice(0, 200) ?? "(no content)",
    })
    await deps.pluginTrigger("experimental.chat.system.transform", { sessionID: input.sessionID }, { system })
    if (system.length === 0) {
      system.push(...original)
    }
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    // Filter out non-provider options (like 'includes' which is for skill loading)
    const agentProviderOptions = { ...input.agent.options }
    delete agentProviderOptions.includes
    // Internal runtime flags; never forward to providers.
    delete agentProviderOptions.skipPermissions
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(agentProviderOptions),
      mergeDeep(variant),
    )
    if (isCodex) {
      options.instructions = SystemPrompt.instructions()
    }

    const params = await deps.pluginTrigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? resolveModelParam("temperature", input.agent, input.model)
          : undefined,
        topP: resolveModelParam("topP", input.agent, input.model),
        topK: resolveModelParam("topK", input.agent, input.model),
        frequencyPenalty: resolveModelParam("frequencyPenalty", input.agent, input.model),
        presencePenalty: resolveModelParam("presencePenalty", input.agent, input.model),
        seed: input.agent.seed,
        options,
      },
    )

    // Enhanced parameter logging for debugging
    l.info("stream params", {
      temperature: params.temperature,
      temperatureSource: input.agent.modelParams
        ? "modelParams"
        : input.agent.temperature !== undefined
          ? "agent"
          : "model",
      topP: params.topP,
      topPSource: input.agent.modelParams ? "modelParams" : input.agent.topP !== undefined ? "agent" : "model",
      topK: params.topK,
      frequencyPenalty: params.frequencyPenalty,
      presencePenalty: params.presencePenalty,
      seed: params.seed,
      variant: input.user.variant ?? "default",
      thinkingBudget: params.options?.thinkingBudget ?? params.options?.thinking?.budget,
      reasoningEffort: params.options?.reasoningEffort ?? params.options?.reasoning_effort,
    })
    l.debug("stream options", { options: params.options })

    const maxOutputTokens = isCodex
      ? undefined
      : ProviderTransform.maxOutputTokens(
          input.model.api.npm,
          params.options,
          input.model.limit.output,
          OUTPUT_TOKEN_MAX,
        )

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    const { headers } = await deps.pluginTrigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const preparedTools = prepareTools({
      model: input.model,
      tools,
      toolChoice: input.toolChoice,
    })

    return streamText({
      onError(error) {
        l.error("stream error", {
          error,
        })
        const streamError = (error as { error?: unknown }).error
        const streamErrorMessage =
          streamError instanceof Error
            ? streamError.message
            : typeof streamError === "object" &&
                streamError !== null &&
                "message" in streamError &&
                typeof (streamError as { message?: unknown }).message === "string"
              ? (streamError as { message: string }).message
              : streamError !== undefined
                ? String(streamError)
                : undefined
        FluxRecorder.record({
          traceID,
          requestID,
          sessionID: input.sessionID,
          messageID: input.user.id,
          providerID: input.model.providerID,
          modelID: input.model.id,
          direction: "outbound",
          domain: "provider",
          kind: "api.outbound.response",
          status: "error",
          error: {
            code: "stream_error",
            message: streamErrorMessage,
          },
        })
      },
      async experimental_repairToolCall(failed) {
        const trimmed = failed.toolCall.toolName.trim()
        const normalized = trimmed.toLowerCase()
        // Try trimmed original case first, then trimmed+lowered
          const repaired = preparedTools.tools[trimmed]
            ? trimmed
            : preparedTools.tools[normalized]
              ? normalized
              : undefined
        if (repaired && repaired !== failed.toolCall.toolName) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired,
          })
          return {
            ...failed.toolCall,
            toolName: repaired,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },
      // Only include sampling parameters if defined - some providers (Google) reject undefined values
      ...(params.temperature !== undefined && { temperature: params.temperature }),
      ...(params.topP !== undefined && { topP: params.topP }),
      ...(params.topK !== undefined && { topK: params.topK }),
      ...(params.frequencyPenalty !== undefined && { frequencyPenalty: params.frequencyPenalty }),
      ...(params.presencePenalty !== undefined && { presencePenalty: params.presencePenalty }),
      ...(params.seed !== undefined && { seed: params.seed }),
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: preparedTools.active,
      tools: preparedTools.tools,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(isCodex
          ? {
              originator: "zee",
              "User-Agent": `zee/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
              session_id: input.sessionID,
            }
          : input.model.providerID !== "anthropic"
            ? {
                "User-Agent": `zee/${Installation.VERSION}`,
              }
            : undefined),
        ...input.model.headers,
        ...headers,
      },
      maxRetries: input.retries ?? 3, // Default to 3 retries for transient failures (timeouts, 503, 429)
      messages: [
        ...(isCodex
          ? [
              {
                role: "user",
                content: system.join("\n\n"),
              } as ModelMessage,
            ]
          : system.map(
              (x): ModelMessage => ({
                role: "system",
                content: x,
              }),
            )),
        ...input.messages,
      ],
      model: wrapLanguageModel({
        // @ts-expect-error - LanguageModel type mismatch between @ai-sdk/provider versions
        model: language,
        middleware: [
          // For models that don't support streaming, simulate it via doGenerate
          ...(input.model.capabilities.streaming === false ? [simulateStreamingMiddleware()] : []),
          {
            specificationVersion: "v3" as const,
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
              }
              return args.params
            },
          },
          {
            specificationVersion: "v3" as const,
            async wrapGenerate({ doGenerate }) {
              const result = await doGenerate()
              return { ...result, usage: normalizeUsage(result.usage) }
            },
            async wrapStream({ doStream }) {
              const result = await doStream()
              return {
                ...result,
                stream: result.stream.pipeThrough(
                  new TransformStream({
                    transform(part, controller) {
                      controller.enqueue(normalizeStreamPart(part))
                    },
                  }),
                ),
              }
            },
          },
        ],
      }),
    })
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      // Map edit-related tools to "edit" permission for user.tools check
      const permission = PermissionNext.EDIT_TOOLS.includes(tool) ? "edit" : tool
      if (input.user.tools?.[permission] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}
