import { describe, expect, test } from "bun:test"
import { unsetEnvVarInText, upsertEnvVarInText } from "../../src/util/env-file"

describe("env-file helpers", () => {
  test("adds missing key to empty file", () => {
    expect(upsertEnvVarInText("", "TELEGRAM_BOT_TOKEN", "abc:123")).toBe("TELEGRAM_BOT_TOKEN=abc:123\n")
  })

  test("replaces existing key", () => {
    const input = "FOO=1\nTELEGRAM_BOT_TOKEN=old\nBAR=2\n"
    const output = upsertEnvVarInText(input, "TELEGRAM_BOT_TOKEN", "new")
    expect(output).toBe("FOO=1\nTELEGRAM_BOT_TOKEN=new\nBAR=2\n")
  })

  test("appends missing key with spacing", () => {
    const input = "# Header\nFOO=1\n"
    const output = upsertEnvVarInText(input, "TELEGRAM_BOT_TOKEN", "new")
    expect(output).toBe("# Header\nFOO=1\n\nTELEGRAM_BOT_TOKEN=new\n")
  })

  test("removes key", () => {
    const input = "FOO=1\nTELEGRAM_BOT_TOKEN=old\nBAR=2\n"
    const output = unsetEnvVarInText(input, "TELEGRAM_BOT_TOKEN")
    expect(output).toBe("FOO=1\nBAR=2\n")
  })
})

