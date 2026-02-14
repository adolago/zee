import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import {
  normalizeRecipientForMetaCli,
  inferMediaType,
  commandExists,
  sendWhatsAppMessage,
  runCommand,
} from "../../../../src/domain/zee/whatsapp-send"

// ---------------------------------------------------------------------------
// normalizeRecipientForMetaCli
// ---------------------------------------------------------------------------

describe("normalizeRecipientForMetaCli", () => {
  test("strips @c.us JID suffix", () => {
    expect(normalizeRecipientForMetaCli("15551234567@c.us")).toBe("+15551234567")
  })

  test("strips @s.whatsapp.net JID suffix", () => {
    expect(normalizeRecipientForMetaCli("15551234567@s.whatsapp.net")).toBe("+15551234567")
  })

  test("strips whatsapp: prefix", () => {
    expect(normalizeRecipientForMetaCli("whatsapp:+15551234567")).toBe("+15551234567")
  })

  test("adds + to bare digits", () => {
    expect(normalizeRecipientForMetaCli("15551234567")).toBe("+15551234567")
  })

  test("preserves existing E.164 format", () => {
    expect(normalizeRecipientForMetaCli("+15551234567")).toBe("+15551234567")
  })

  test("rejects group JIDs", () => {
    const result = normalizeRecipientForMetaCli("120363123456789@g.us")
    expect(result).toEqual(expect.objectContaining({ error: expect.stringContaining("Group JIDs") }))
  })

  test("rejects empty string", () => {
    const result = normalizeRecipientForMetaCli("")
    expect(result).toEqual(expect.objectContaining({ error: "Empty recipient" }))
  })

  test("handles JID with device suffix (1234:0@s.whatsapp.net)", () => {
    expect(normalizeRecipientForMetaCli("15551234567:0@s.whatsapp.net")).toBe("+15551234567")
  })
})

// ---------------------------------------------------------------------------
// inferMediaType
// ---------------------------------------------------------------------------

describe("inferMediaType", () => {
  test("jpg -> image", () => expect(inferMediaType("photo.jpg")).toBe("image"))
  test("jpeg -> image", () => expect(inferMediaType("photo.jpeg")).toBe("image"))
  test("png -> image", () => expect(inferMediaType("photo.png")).toBe("image"))
  test("webp -> image", () => expect(inferMediaType("sticker.webp")).toBe("image"))
  test("gif -> image", () => expect(inferMediaType("anim.gif")).toBe("image"))

  test("mp4 -> video", () => expect(inferMediaType("clip.mp4")).toBe("video"))
  test("3gp -> video", () => expect(inferMediaType("clip.3gp")).toBe("video"))

  test("pdf -> document", () => expect(inferMediaType("file.pdf")).toBe("document"))
  test("docx -> document", () => expect(inferMediaType("file.docx")).toBe("document"))
  test("unknown -> document", () => expect(inferMediaType("file.xyz")).toBe("document"))

  test("handles URL paths", () => {
    expect(inferMediaType("https://example.com/photo.png")).toBe("image")
  })
})

// ---------------------------------------------------------------------------
// commandExists
// ---------------------------------------------------------------------------

describe("commandExists", () => {
  test("returns true for relative/bare commands (deferred to PATH)", () => {
    expect(commandExists("meta")).toBe(true)
  })

  test("returns false for nonexistent absolute path", () => {
    expect(commandExists("/nonexistent/path/to/meta-cli-binary")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// sendWhatsAppMessage
// ---------------------------------------------------------------------------

describe("sendWhatsAppMessage", () => {
  test("rejects group JIDs before spawning", async () => {
    const result = await sendWhatsAppMessage({
      to: "120363123456789@g.us",
      message: "Hello group",
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe("META_CLI_FAILED")
      expect(result.error).toContain("Group JIDs")
    }
  })

  test("rejects empty recipient", async () => {
    const result = await sendWhatsAppMessage({
      to: "",
      message: "Hello",
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe("META_CLI_FAILED")
      expect(result.error).toBe("Empty recipient")
    }
  })
})

// ---------------------------------------------------------------------------
// runCommand
// ---------------------------------------------------------------------------

describe("runCommand", () => {
  test("captures stdout from a successful command", async () => {
    const result = await runCommand("echo", ["hello"], 5000)
    expect(result.ok).toBe(true)
    expect(result.stdout.trim()).toBe("hello")
    expect(result.exitCode).toBe(0)
  })

  test("captures stderr and non-zero exit code", async () => {
    const result = await runCommand("sh", ["-c", "echo err >&2; exit 1"], 5000)
    expect(result.ok).toBe(false)
    expect(result.stderr.trim()).toBe("err")
    expect(result.exitCode).toBe(1)
  })

  test("reports notFound for missing binary", async () => {
    const result = await runCommand("/nonexistent/binary", [], 5000)
    expect(result.ok).toBe(false)
    expect(result.notFound).toBe(true)
  })

  test("times out long-running commands", async () => {
    const result = await runCommand("sleep", ["60"], 100)
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
  })
})
