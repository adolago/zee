import { describe, expect, test } from "bun:test"
import { sanitizeHeartbeatText, stripHeartbeatAck } from "../../src/heartbeat/tokens"

describe("heartbeat tokens", () => {
  test("sanitizes leaked thought blocks", () => {
    const input = `![thought
internal notes
]`
    expect(sanitizeHeartbeatText(input)).toBe("")
  })

  test("sanitizes non-ascii prefixed thought leaks", () => {
    const input = `烂thought
CRITICAL INSTRUCTION:
reply HEARTBEAT_OK`
    expect(sanitizeHeartbeatText(input)).toBe("")
  })

  test("sanitizes empty json artifacts", () => {
    const input = `json
{"content": ""}`
    expect(sanitizeHeartbeatText(input)).toBe("")
  })

  test("sanitizes leaked transcript-style thought/tool payload blocks", () => {
    const input = `💭thought
CRITICAL INSTRUCTION 1:
Use bash commands to inspect the daemon.
json
{"command":"systemctl --user status zee","description":"Check daemon status"}`
    expect(sanitizeHeartbeatText(input)).toBe("")
  })

  test("keeps meaningful text", () => {
    const input = "Good morning. Calendar is clear today."
    expect(sanitizeHeartbeatText(input)).toBe(input)
  })

  test("strips heartbeat ack token", () => {
    expect(stripHeartbeatAck("**HEARTBEAT_OK**")).toBe("")
  })
})
