const DEFAULT_INTERVAL_MS = 2_000

export function parseParentPid(value: string | undefined): number | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed <= 1) return undefined
  return parsed
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "EPERM") return true
    return false
  }
}

export function installMcpParentGuard(
  serverName: string,
  options: {
    env?: NodeJS.ProcessEnv
    intervalMs?: number
    getPpid?: () => number
    isAlive?: (pid: number) => boolean
    exitFn?: (code?: number) => never | void
    logger?: (line: string) => void
    setIntervalFn?: typeof setInterval
    clearIntervalFn?: typeof clearInterval
  } = {},
): { stop: () => void } | undefined {
  const env = options.env ?? process.env
  const expectedParentPid = parseParentPid(env.ZEE_PARENT_PID)
  if (!expectedParentPid) return undefined

  const getPpid = options.getPpid ?? (() => process.ppid)
  const isAlive = options.isAlive ?? isPidAlive
  const exitFn = options.exitFn ?? ((code?: number) => process.exit(code))
  const logger =
    options.logger ??
    ((line: string) => {
      console.error(line)
    })
  const setIntervalFn = options.setIntervalFn ?? setInterval
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval

  const intervalMs =
    typeof options.intervalMs === "number" && options.intervalMs >= 250
      ? Math.floor(options.intervalMs)
      : DEFAULT_INTERVAL_MS

  let stopped = false

  const stop = () => {
    if (stopped) return
    stopped = true
    clearIntervalFn(timer)
  }

  const check = () => {
    if (stopped) return
    const currentPpid = getPpid()
    const parentAlive = isAlive(expectedParentPid)
    if (currentPpid <= 1 || !parentAlive) {
      stop()
      logger(
        `[zee-mcp:${serverName}] parent process ${expectedParentPid} is gone; exiting to prevent orphaned MCP workers.`,
      )
      exitFn(0)
    }
  }

  const timer = setIntervalFn(check, intervalMs)
  timer.unref?.()

  process.once("exit", stop)
  check()

  return { stop }
}
