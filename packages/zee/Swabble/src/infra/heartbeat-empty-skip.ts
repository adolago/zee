import { isHeartbeatContentEffectivelyEmpty } from "../auto-reply/heartbeat.js"

export function shouldSkipForEmptyHeartbeatFile(params: { heartbeatFileContent: string; reason?: string }): boolean {
  const isExecEventReason = params.reason === "exec-event"
  const isCronEventReason = Boolean(params.reason?.startsWith("cron:"))
  const isWakeReason = params.reason === "wake" || Boolean(params.reason?.startsWith("hook:"))

  return (
    isHeartbeatContentEffectivelyEmpty(params.heartbeatFileContent) &&
    !isExecEventReason &&
    !isCronEventReason &&
    !isWakeReason
  )
}
