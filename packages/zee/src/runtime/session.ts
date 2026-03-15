import type { MessageV2 } from "@/session/message-v2"
import { SessionProcessor } from "@/session/processor"
import type { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  recordOpenCodeRuntimeRoute,
  resolveOpenCodeRuntimeSurface,
  type OpenCodeRuntimeRouteSelection,
} from "./opencode-rollout"

const log = Log.create({ service: "runtime:session" })

function logRouteProcessing(
  input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    source?: "prompt" | "compaction"
  },
  route: {
    surface: "cli" | "orchestration" | "gateway"
    selection: OpenCodeRuntimeRouteSelection
  },
) {
  const payload = {
    sessionID: input.sessionID,
    messageID: input.assistantMessage.id,
    source: input.source ?? "prompt",
    surface: route.surface,
    route: route.selection.route,
    reason: route.selection.reason,
    allowLegacyFallback: route.selection.allowLegacyFallback,
  }

  if (route.selection.route === "legacy_fallback") {
    log.warn("Session runtime using legacy fallback path", payload)
    return
  }

  log.info("Session runtime using OpenCode primary path", payload)
}

export async function createSessionRuntimeProcessor(input: {
  assistantMessage: MessageV2.Assistant
  sessionID: string
  model: Provider.Model
  abort: AbortSignal
  surface?: "cli" | "orchestration" | "gateway"
  sessionSurface?: "cli" | "web" | "api" | "whatsapp" | "telegram"
  source?: "prompt" | "compaction"
}) {
  const surface =
    input.surface ??
    resolveOpenCodeRuntimeSurface({
      client: process.env.ZEE_CLIENT,
      sessionSurface: input.sessionSurface,
    })

  const selection = recordOpenCodeRuntimeRoute({
    surface,
    sessionID: input.sessionID,
    messageID: input.assistantMessage.id,
    providerID: input.model.providerID,
    modelID: input.model.id,
    metadata: {
      source: input.source ?? "prompt",
      sessionSurface: input.sessionSurface,
    },
  })

  const processor = SessionProcessor.create(input)
  return {
    ...processor,
    async process(processInput: Parameters<typeof processor.process>[0]) {
      logRouteProcessing(input, { surface, selection })
      return processor.process(processInput)
    },
  }
}
