import { describe, expect, test } from "bun:test"
import { parseDaemonCommandLineArgs } from "../../src/cli/cmd/daemon-cmdline"

describe("daemon cmdline parser", () => {
  test("parses NUL-separated /proc cmdline payloads", () => {
    const cmdline = ["zee", "daemon", "--port", "18789", ""].join("\0")
    expect(parseDaemonCommandLineArgs(cmdline)).toEqual(["zee", "daemon", "--port", "18789"])
  })

  test("preserves Windows drive-path backslashes in ps-style command lines", () => {
    const input =
      '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\zee\\dist\\index.js daemon --port 18789'

    expect(parseDaemonCommandLineArgs(input)).toEqual([
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\zee\\dist\\index.js",
      "daemon",
      "--port",
      "18789",
    ])
  })

  test("preserves UNC backslashes in quoted arguments", () => {
    const input = '"\\\\fileserver\\Zee Share\\node.exe" "\\\\fileserver\\Zee Share\\dist\\index.js" daemon --port 18789'

    expect(parseDaemonCommandLineArgs(input)).toEqual([
      "\\\\fileserver\\Zee Share\\node.exe",
      "\\\\fileserver\\Zee Share\\dist\\index.js",
      "daemon",
      "--port",
      "18789",
    ])
  })

  test("preserves literal backslash-n sequences in Windows paths", () => {
    const input = "zee daemon --state C:\\Work\\nxxx\\README.md"

    expect(parseDaemonCommandLineArgs(input)).toEqual(["zee", "daemon", "--state", "C:\\Work\\nxxx\\README.md"])
  })
})
