import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "experimental-hooks" })

type HookCommand = {
  command: string[]
  environment?: Record<string, string>
}

const MAX_CAPTURE_CHARS = 32_000
const globCache = new Map<string, Bun.Glob>()

function normalizeRelPath(input: string): string {
  // Bun.Glob patterns are POSIX-like; normalize to forward slashes for stable matching.
  return input.replaceAll("\\", "/")
}

function truncate(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input
  return input.slice(0, maxChars) + `\n... (truncated ${input.length - maxChars} chars)`
}

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    env[key] = value
  }
  return env
}

function getGlob(pattern: string): Bun.Glob | null {
  const cached = globCache.get(pattern)
  if (cached) return cached

  try {
    const glob = new Bun.Glob(pattern)
    globCache.set(pattern, glob)
    return glob
  } catch (error) {
    log.error("invalid experimental hook glob pattern", {
      pattern,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function runHookCommand(input: {
  event: "file_edited" | "session_completed"
  command: string[]
  environment?: Record<string, string>
  extraEnv: Record<string, string>
}): Promise<void> {
  if (input.command.length === 0) {
    log.warn("skipping experimental hook with empty command", { event: input.event })
    return
  }

  const env: Record<string, string> = {
    ...baseEnv(),
    ...(input.environment ?? {}),
    ...input.extraEnv,
  }

  const start = Date.now()

  try {
    const proc = Bun.spawn(input.command, {
      cwd: Instance.directory,
      env,
      stdout: "pipe",
      stderr: "pipe",
    })

    // Read both streams concurrently to avoid deadlocks on large output.
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    const durationMs = Date.now() - start

    if (exitCode !== 0) {
      log.error("experimental hook command failed", {
        event: input.event,
        command: input.command,
        exitCode,
        durationMs,
        stdout: stdout ? truncate(stdout, MAX_CAPTURE_CHARS) : undefined,
        stderr: stderr ? truncate(stderr, MAX_CAPTURE_CHARS) : undefined,
      })
      return
    }

    log.debug("experimental hook command completed", {
      event: input.event,
      command: input.command,
      durationMs,
    })
  } catch (error) {
    const durationMs = Date.now() - start
    log.error("failed to execute experimental hook command", {
      event: input.event,
      command: input.command,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export namespace ExperimentalHooks {
  export async function triggerFileEdited(input: {
    sessionID: string
    filePathAbs: string
    filePathRel: string
  }): Promise<void> {
    let config: Awaited<ReturnType<typeof Config.get>>
    try {
      config = await Config.get()
    } catch (error) {
      log.error("failed to load config for experimental hooks", {
        event: "file_edited",
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const rules = config.experimental?.hook?.file_edited
    if (!rules) return

    const normalizedRelPath = normalizeRelPath(input.filePathRel)

    const commands: HookCommand[] = []
    for (const [pattern, hooks] of Object.entries(rules)) {
      const glob = getGlob(pattern)
      if (!glob) continue
      if (!glob.match(normalizedRelPath)) continue
      commands.push(...hooks)
    }

    if (commands.length === 0) return

    log.info("running experimental file_edited hooks", {
      file: normalizedRelPath,
      count: commands.length,
    })

    for (const hook of commands) {
      await runHookCommand({
        event: "file_edited",
        command: hook.command,
        environment: hook.environment,
        extraEnv: {
          ZEE_HOOK_EVENT: "file_edited",
          ZEE_SESSION_ID: input.sessionID,
          ZEE_WORKTREE: Instance.worktree,
          ZEE_CWD: Instance.directory,
          ZEE_FILE_PATH: input.filePathAbs,
          ZEE_FILE_RELATIVE: normalizedRelPath,
        },
      })
    }
  }

  export async function triggerSessionCompleted(input: {
    sessionID: string
    todosCompleted: number
    todosRemaining: number
  }): Promise<void> {
    let config: Awaited<ReturnType<typeof Config.get>>
    try {
      config = await Config.get()
    } catch (error) {
      log.error("failed to load config for experimental hooks", {
        event: "session_completed",
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const hooks = config.experimental?.hook?.session_completed
    if (!hooks || hooks.length === 0) return

    log.info("running experimental session_completed hooks", {
      sessionID: input.sessionID,
      count: hooks.length,
      todosCompleted: input.todosCompleted,
      todosRemaining: input.todosRemaining,
    })

    for (const hook of hooks) {
      await runHookCommand({
        event: "session_completed",
        command: hook.command,
        environment: hook.environment,
        extraEnv: {
          ZEE_HOOK_EVENT: "session_completed",
          ZEE_SESSION_ID: input.sessionID,
          ZEE_WORKTREE: Instance.worktree,
          ZEE_CWD: Instance.directory,
        },
      })
    }
  }
}

