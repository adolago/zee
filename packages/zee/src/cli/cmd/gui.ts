import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { cmd } from "./cmd"
import { Global } from "../../global"
import { UI } from "../ui"

type RuntimeMode = "zee" | "legacy" | "dual"

type GuiArgs = {
  runtimeMode?: RuntimeMode
  sidebar?: boolean
  release?: boolean
  noBuild?: boolean
}

const BINARY_NAME = process.platform === "win32" ? "zee-gui.exe" : "zee-gui"

function binaryCandidates(sourceRoot: string, profile: "debug" | "release"): string[] {
  return [
    path.join(sourceRoot, "target", profile, BINARY_NAME),
    path.join(sourceRoot, "packages", "zee-gui", "target", profile, BINARY_NAME),
  ]
}

function resolveGuiBinary(sourceRoot: string, profile: "debug" | "release"): string | undefined {
  for (const candidate of binaryCandidates(sourceRoot, profile)) {
    if (fs.existsSync(candidate)) return candidate
  }
  return Bun.which("zee-gui") ?? undefined
}

async function buildGuiBinary(sourceRoot: string, release: boolean): Promise<boolean> {
  const cmdline = ["cargo", "build", "-p", "zee-gui"]
  if (release) cmdline.push("--release")
  const proc = Bun.spawn({
    cmd: cmdline,
    cwd: sourceRoot,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  })
  return (await proc.exited) === 0
}

function launchGui(binary: string, sourceRoot: string, env: NodeJS.ProcessEnv) {
  const child = spawn(binary, [], {
    cwd: sourceRoot,
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  child.unref()
}

export const GuiCommand = cmd({
  command: "gui",
  describe: "launch the Rust Zee GUI",
  builder: (yargs) =>
    yargs
      .option("runtime-mode", {
        type: "string",
        choices: ["zee", "legacy", "dual"],
        default: "dual",
        describe: "GUI runtime transport mode",
      })
      .option("sidebar", {
        type: "boolean",
        default: false,
        describe: "open Zee sidecar panel on launch",
      })
      .option("release", {
        type: "boolean",
        default: false,
        describe: "launch release binary instead of debug",
      })
      .option("no-build", {
        type: "boolean",
        default: false,
        describe: "fail if binary is missing instead of auto-building",
      }),
  handler: async (args) => {
    const typed = args as GuiArgs
    const sourceRoot = Global.Path.source
    const profile = typed.release ? "release" : "debug"

    let binary = resolveGuiBinary(sourceRoot, profile)
    if (!binary) {
      if (typed.noBuild) {
        UI.error("zee-gui binary not found. Re-run without --no-build to auto-build.")
        process.exitCode = 1
        return
      }
      UI.info("zee-gui binary not found. Building now...")
      const built = await buildGuiBinary(sourceRoot, !!typed.release)
      if (!built) {
        UI.error("Failed to build zee-gui.")
        process.exitCode = 1
        return
      }
      binary = resolveGuiBinary(sourceRoot, profile)
      if (!binary) {
        UI.error("Build finished but zee-gui binary is still missing.")
        process.exitCode = 1
        return
      }
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ZEE_GUI_RUNTIME_MODE: typed.runtimeMode ?? "dual",
    }
    if (typed.sidebar) env.ZEE_GUI_SIDECAR = "1"

    launchGui(binary, sourceRoot, env)
    UI.success(`Started Zee GUI (${profile}).`)
    UI.info(`Runtime mode: ${env.ZEE_GUI_RUNTIME_MODE}`)
    if (typed.sidebar) UI.info("Sidecar mode enabled.")
  },
})
