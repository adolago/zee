import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

describe("awareness tool catalog wiring", () => {
  test("prioritizes zee browser tools over legacy kernel browser tool IDs", async () => {
    const catalogPath = path.join(process.cwd(), "../../src/awareness/tool-catalog.ts")
    const content = await fs.readFile(catalogPath, "utf-8")

    expect(content).toContain('"zee:browser"')
    expect(content).toContain('"zee:browser-standalone"')
    expect(content).not.toContain('"kernel_create_browser"')
    expect(content).not.toContain('"kernel_execute_playwright_code"')
  })
})
