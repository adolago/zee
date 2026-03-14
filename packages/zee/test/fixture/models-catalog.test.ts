import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { parseModelsCatalog } from "./models-catalog"

describe("models catalog fixture", () => {
  test("merges duplicate provider entries from the checked-in fixture", async () => {
    const raw = await fs.readFile(path.join(import.meta.dir, "..", "tool", "fixtures", "models-api.json"), "utf8")
    const catalog = parseModelsCatalog(raw)
    const openaiModels = catalog["openai"]?.models ?? {}

    expect(openaiModels["gpt-5.4"]).toBeDefined()
    expect(openaiModels["gpt-5.2"]).toBeDefined()
    expect(openaiModels["gpt-5.2-pro"]).toBeDefined()
  })
})
