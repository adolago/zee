import { describe, expect, test } from "bun:test"
import path from "path"
import { Config } from "../../src/config/config"
import { tmpdir } from "../fixture/fixture"

describe("Config.loadThemeFile", () => {
  test("parses JSON theme files", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "theme.json")
    await Bun.write(
      filepath,
      JSON.stringify({
        theme: {
          primary: "#123456",
          secondary: "#654321",
        },
      }),
    )

    const theme = await Config.loadThemeFile(filepath)
    expect(theme.theme.primary).toBe("#123456")
    expect(theme.theme.secondary).toBe("#654321")
  })

  test("parses JSONC theme files with comments and trailing commas", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "theme.jsonc")
    await Bun.write(
      filepath,
      `{
        // user theme
        "theme": {
          "primary": "#abcdef",
          "secondary": "#fedcba",
        },
      }`,
    )

    const theme = await Config.loadThemeFile(filepath)
    expect(theme.theme.primary).toBe("#abcdef")
    expect(theme.theme.secondary).toBe("#fedcba")
  })
})
