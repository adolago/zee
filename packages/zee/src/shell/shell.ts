import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import type { SpawnOptions } from "child_process"

const SPAWN_RETRY_CODES = new Set(["EAGAIN", "EMFILE", "ENFILE", "ENOMEM"])
const SPAWN_RETRY_MAX_ATTEMPTS = 3
const SPAWN_RETRY_DELAY_MS = 50

const SIGKILL_TIMEOUT_MS = 200

export namespace Shell {
  function shouldRetrySpawn(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && SPAWN_RETRY_CODES.has(error.code as string)
  }

  export async function spawnWithRetry(command: string, options?: SpawnOptions): Promise<ChildProcess>
  export async function spawnWithRetry(command: string, args: string[], options?: SpawnOptions): Promise<ChildProcess>
  export async function spawnWithRetry(
    command: string,
    argsOrOptions?: string[] | SpawnOptions,
    maybeOptions?: SpawnOptions,
  ): Promise<ChildProcess> {
    const hasArgs = Array.isArray(argsOrOptions)
    const args = hasArgs ? (argsOrOptions as string[]) : undefined
    const options = (hasArgs ? maybeOptions : argsOrOptions) as SpawnOptions | undefined

    let attempt = 0
    while (true) {
      try {
        if (args) {
          return spawn(command, args, options ?? {})
        }
        return spawn(command, options ?? {})
      } catch (error) {
        if (!shouldRetrySpawn(error) || attempt >= SPAWN_RETRY_MAX_ATTEMPTS) {
          throw error
        }
        attempt += 1
        await Bun.sleep((2 ** attempt) * SPAWN_RETRY_DELAY_MS)
      }
    }
  }

  export async function killTree(proc: ChildProcess, opts?: { exited?: () => boolean }): Promise<void> {
    const pid = proc.pid
    if (!pid || opts?.exited?.()) return

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" })
        killer.once("exit", () => resolve())
        killer.once("error", () => resolve())
      })
      return
    }

    try {
      process.kill(-pid, "SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        process.kill(-pid, "SIGKILL")
      }
    } catch (_e) {
      proc.kill("SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        proc.kill("SIGKILL")
      }
    }
  }
  const BLACKLIST = new Set(["fish", "nu"])

  function fallback() {
    if (process.platform === "win32") {
      if (Flag.ZEE_GIT_BASH_PATH) return Flag.ZEE_GIT_BASH_PATH
      const git = Bun.which("git")
      if (git) {
        // git.exe is typically at: C:\Program Files\Git\cmd\git.exe
        // bash.exe is at: C:\Program Files\Git\bin\bash.exe
        const bash = path.join(git, "..", "..", "bin", "bash.exe")
        if (Bun.file(bash).size) return bash
      }
      return process.env.COMSPEC || "cmd.exe"
    }
    const bash = Bun.which("bash")
    if (bash) return bash
    return "/bin/sh"
  }

  export const preferred = lazy(() => {
    const s = process.env.SHELL
    if (s) return s
    return fallback()
  })

  export const acceptable = lazy(() => {
    const s = process.env.SHELL
    if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s
    return fallback()
  })
}
