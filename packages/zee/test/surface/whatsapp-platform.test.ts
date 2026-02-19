import { describe, expect, test } from "bun:test"
import {
  normalizeInboundTextNewlines,
  toPlatformMessage,
  type ForwardedMessage,
} from "../../src/surface/platforms/whatsapp"

describe("normalizeInboundTextNewlines", () => {
  test("normalizes CRLF and CR to LF", () => {
    expect(normalizeInboundTextNewlines("a\r\nb\rc")).toBe("a\nb\nc")
  })

  test("preserves literal backslash-n sequences for Windows paths", () => {
    const windowsPath = "C:\\Work\\nxxx\\README.md"
    expect(normalizeInboundTextNewlines(windowsPath)).toBe("C:\\Work\\nxxx\\README.md")
  })
})

describe("toPlatformMessage", () => {
  test("normalizes only actual newline characters and preserves literal backslash-n", () => {
    const forwarded: ForwardedMessage = {
      id: "wamid.123",
      senderId: "15551234567",
      body: "Line 1\r\nC:\\Work\\nxxx\\README.md",
      timestamp: 1_717_000_000_000,
      isGroup: false,
      replyToId: "wamid.parent",
      platform: "whatsapp",
    }

    expect(toPlatformMessage(forwarded)).toMatchObject({
      id: "wamid.123",
      senderId: "15551234567",
      body: "Line 1\nC:\\Work\\nxxx\\README.md",
      replyToId: "wamid.parent",
      platform: "whatsapp",
    })
  })
})
