import { describe, expect, it } from "vitest"
import { shouldSkipForEmptyHeartbeatFile } from "./heartbeat-empty-skip.js"

describe("shouldSkipForEmptyHeartbeatFile", () => {
  const emptyHeartbeat = "# HEARTBEAT.md\n\n"
  const nonEmptyHeartbeat = "- Check inbox"

  it("skips regular heartbeat reasons when file is effectively empty", () => {
    expect(
      shouldSkipForEmptyHeartbeatFile({
        heartbeatFileContent: emptyHeartbeat,
        reason: "interval",
      }),
    ).toBe(true)
  })

  it("does not skip exec-event reasons", () => {
    expect(
      shouldSkipForEmptyHeartbeatFile({
        heartbeatFileContent: emptyHeartbeat,
        reason: "exec-event",
      }),
    ).toBe(false)
  })

  it("does not skip cron reasons", () => {
    expect(
      shouldSkipForEmptyHeartbeatFile({
        heartbeatFileContent: emptyHeartbeat,
        reason: "cron:daily",
      }),
    ).toBe(false)
  })

  it("does not skip wake reasons", () => {
    expect(
      shouldSkipForEmptyHeartbeatFile({
        heartbeatFileContent: emptyHeartbeat,
        reason: "wake",
      }),
    ).toBe(false)
  })

  it("does not skip hook reasons", () => {
    expect(
      shouldSkipForEmptyHeartbeatFile({
        heartbeatFileContent: emptyHeartbeat,
        reason: "hook:wake",
      }),
    ).toBe(false)
    expect(
      shouldSkipForEmptyHeartbeatFile({
        heartbeatFileContent: emptyHeartbeat,
        reason: "hook:job-123:error",
      }),
    ).toBe(false)
  })

  it("does not skip when heartbeat file has actionable content", () => {
    expect(
      shouldSkipForEmptyHeartbeatFile({
        heartbeatFileContent: nonEmptyHeartbeat,
        reason: "interval",
      }),
    ).toBe(false)
  })
})
