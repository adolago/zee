import { describe, expect, test } from "bun:test"
import { Installation } from "../../src/installation"

describe("Installation.runtimeMode", () => {
  test("treats interpreted runtimes as source across platforms", () => {
    expect(Installation.runtimeMode("/usr/local/bin/bun")).toBe("source")
    expect(Installation.runtimeMode("C:\\Users\\runneradmin\\.bun\\bin\\bun.exe")).toBe("source")
    expect(Installation.runtimeMode("C:\\Program Files\\nodejs\\node.exe")).toBe("source")
  })

  test("treats packaged executables as binary", () => {
    expect(Installation.runtimeMode("/tmp/zee/bin/zee")).toBe("binary")
    expect(Installation.runtimeMode("D:\\a\\zee\\zee\\packages\\zee\\dist\\@adolago\\zee-windows-x64\\bin\\zee.exe")).toBe(
      "binary",
    )
  })
})
