import type { LanguageModelV2FinishReason } from "@ai-sdk/provider"

export function mapOpenAIResponseFinishReason({
  finishReason,
  hasFunctionCall,
}: {
  finishReason: string | null | undefined
  // flag that checks if there have been client-side tool calls (not executed by openai)
  hasFunctionCall: boolean
}): LanguageModelV2FinishReason {
  switch (finishReason) {
    case undefined:
    case null:
    case "": // GPT-5 bug: sometimes returns empty string instead of null
      return hasFunctionCall ? "tool-calls" : "stop"
    case "max_output_tokens":
    case "length":
      return "length"
    case "content_filter":
      return "content-filter"
    case "server_error":
    case "interruption":
    case "turn_limit":
    case "cancelled":
      // Log unexpected incomplete reasons for diagnostics
      console.warn(`[openai] Response incomplete: ${finishReason}`)
      return "error"
    default:
      // Log unknown reasons for debugging - this helps identify new API values
      console.warn(`[openai] Unknown finish reason: "${finishReason}"`)
      return hasFunctionCall ? "tool-calls" : "unknown"
  }
}
