import { spawn } from "node:child_process"

export type ServerOptions = {
  hostname?: string
  port?: number
  signal?: AbortSignal
  timeout?: number
  config?: Record<string, unknown>
}

export type TuiOptions = {
  project?: string
  model?: string
  session?: string
  agent?: string
  signal?: AbortSignal
  config?: Record<string, unknown>
}

/**
 * Creates and starts a Zee daemon server
 * @param options Server configuration options
 * @returns Server instance with url and close method
 */
async function spawnZeeCli(
  args: string[],
  opts: Parameters<typeof spawn>[2],
): Promise<ReturnType<typeof spawn>> {
  const candidates = ["zee"] as const
  let lastError: unknown

  for (const cmd of candidates) {
    const proc = spawn(cmd, args, opts)
    try {
      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          cleanup()
          resolve()
        }
        const onError = (err: unknown) => {
          cleanup()
          reject(err)
        }
        const cleanup = () => {
          proc.off("spawn", onSpawn)
          proc.off("error", onError as any)
        }
        proc.once("spawn", onSpawn)
        proc.once("error", onError as any)
      })
      return proc
    } catch (err: any) {
      lastError = err
      if (err?.code === "ENOENT") continue
      throw err
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to spawn zee CLI")
}

export async function createZeeServer(options?: ServerOptions) {
  const opts = {
    hostname: "127.0.0.1",
    port: 3210,
    timeout: 5000,
    ...options,
  }

  const args = [`serve`, `--hostname=${opts.hostname}`, `--port=${opts.port}`]
  if (opts.config?.logLevel) args.push(`--log-level=${opts.config.logLevel}`)

  const proc = await spawnZeeCli(args, {
    signal: opts.signal,
    env: {
      ...process.env,
      ZEE_CONFIG_CONTENT: JSON.stringify(opts.config ?? {}),
    },
  })

  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`Timeout waiting for server to start after ${opts.timeout}ms`))
    }, opts.timeout)

    let output = ""

    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
      const lines = output.split("\n")
      for (const line of lines) {
        if (line.startsWith("zee server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
          if (!match) {
            throw new Error(`Failed to parse server url from output: ${line}`)
          }
          clearTimeout(id)
          resolve(match[1]!)
          return
        }
      }
    })

    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
    })

    proc.on("exit", (code) => {
      clearTimeout(id)
      let msg = `Server exited with code ${code}`
      if (output.trim()) {
        msg += `\nServer output: ${output}`
      }
      reject(new Error(msg))
    })

    proc.on("error", (error) => {
      clearTimeout(id)
      reject(error)
    })

    if (opts.signal) {
      opts.signal.addEventListener("abort", () => {
        clearTimeout(id)
        reject(new Error("Aborted"))
      })
    }
  })

  return {
    url,
    close() {
      proc.kill()
    },
  }
}

/**
 * Creates and launches the Zee TUI
 * @param options TUI configuration options
 * @returns TUI instance with close method
 */
export function createZeeTui(options?: TuiOptions) {
  const args: string[] = []

  if (options?.project) {
    args.push(`--project=${options.project}`)
  }
  if (options?.model) {
    args.push(`--model=${options.model}`)
  }
  if (options?.session) {
    args.push(`--session=${options.session}`)
  }
  if (options?.agent) {
    args.push(`--agent=${options.agent}`)
  }

  const procPromise = spawnZeeCli(args, {
    signal: options?.signal,
    stdio: "inherit",
    env: {
      ...process.env,
      ZEE_CONFIG_CONTENT: JSON.stringify(options?.config ?? {}),
    },
  })

  return {
    close() {
      procPromise.then((proc) => proc.kill()).catch(() => {})
    },
  }
}
