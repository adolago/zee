import type { MessageV2 } from "@/session/message-v2"
import { SessionProcessor } from "@/session/processor"
import type { Provider } from "@/provider/provider"

export async function createSessionRuntimeProcessor(input: {
  assistantMessage: MessageV2.Assistant
  sessionID: string
  model: Provider.Model
  abort: AbortSignal
}) {
  return SessionProcessor.create(input)
}
