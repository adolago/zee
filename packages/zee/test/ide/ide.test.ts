import { describe, expect, test, afterEach } from "bun:test"
import { Ide } from "../../src/ide"

describe("ide", () => {
  const original = structuredClone(process.env)

  afterEach(() => {
    Object.keys(process.env).forEach((key) => {
      delete process.env[key]
    })
    Object.assign(process.env, original)
  })

  test("should detect Visual Studio Code", () => {
    process.env["TERM_PROGRAM"] = "vscode"
    process.env["GIT_ASKPASS"] = "/opt/vscode/Visual Studio Code/resources/app/extensions/git/dist/askpass.sh"

    expect(Ide.ide()).toBe("Visual Studio Code")
  })

  test("should detect Visual Studio Code Insiders", () => {
    process.env["TERM_PROGRAM"] = "vscode"
    process.env["GIT_ASKPASS"] =
      "/opt/vscode/Visual Studio Code - Insiders/resources/app/extensions/git/dist/askpass.sh"

    expect(Ide.ide()).toBe("Visual Studio Code - Insiders")
  })

  test("should detect Cursor", () => {
    process.env["TERM_PROGRAM"] = "vscode"
    process.env["GIT_ASKPASS"] = "/opt/cursor/Cursor/resources/app/extensions/git/dist/askpass.sh"

    expect(Ide.ide()).toBe("Cursor")
  })

  test("should detect VSCodium", () => {
    process.env["TERM_PROGRAM"] = "vscode"
    process.env["GIT_ASKPASS"] = "/opt/vscodium/VSCodium/resources/app/extensions/git/dist/askpass.sh"

    expect(Ide.ide()).toBe("VSCodium")
  })

  test("should detect Windsurf", () => {
    process.env["TERM_PROGRAM"] = "vscode"
    process.env["GIT_ASKPASS"] = "/opt/windsurf/Windsurf/resources/app/extensions/git/dist/askpass.sh"

    expect(Ide.ide()).toBe("Windsurf")
  })

  test("should return unknown when TERM_PROGRAM is not vscode", () => {
    process.env["TERM_PROGRAM"] = "iTerm2"
    process.env["GIT_ASKPASS"] =
      "/opt/vscode/Visual Studio Code - Insiders/resources/app/extensions/git/dist/askpass.sh"

    expect(Ide.ide()).toBe("unknown")
  })

  test("should return unknown when GIT_ASKPASS does not contain IDE name", () => {
    process.env["TERM_PROGRAM"] = "vscode"
    process.env["GIT_ASKPASS"] = "/path/to/unknown/askpass.sh"

    expect(Ide.ide()).toBe("unknown")
  })

  test("should recognize vscode-insiders ZEE_CALLER", () => {
    process.env["ZEE_CALLER"] = "vscode-insiders"

    expect(Ide.alreadyInstalled()).toBe(true)
  })

  test("should recognize vscode ZEE_CALLER", () => {
    process.env["ZEE_CALLER"] = "vscode"

    expect(Ide.alreadyInstalled()).toBe(true)
  })

  test("should return false for unknown ZEE_CALLER", () => {
    process.env["ZEE_CALLER"] = "unknown"

    expect(Ide.alreadyInstalled()).toBe(false)
  })
})
