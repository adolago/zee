import fs from "node:fs/promises"
import path from "node:path"
import net from "node:net"
import type { ReliabilityCommandOptions, ReliabilityCommandResult } from "./types"

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function writeText(filepath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filepath))
  await fs.writeFile(filepath, content, "utf-8")
}

export async function appendText(filepath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filepath))
  await fs.appendFile(filepath, content, "utf-8")
}

export function sanitizeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
}

export function stringifyCommand(args: string[]): string {
  return args
    .map((item) => {
      if (item === "") return '""'
      if (/^[a-zA-Z0-9_./:@=-]+$/.test(item)) return item
      return JSON.stringify(item)
    })
    .join(" ")
}

export async function runCommand(
  command: string[],
  options: ReliabilityCommandOptions = {},
): Promise<ReliabilityCommandResult> {
  if (command.length === 0) {
    throw new Error("Cannot run empty command")
  }

  const cwd = options.cwd ?? process.cwd()
  const env = { ...process.env, ...(options.env ?? {}) }
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? 60_000
  const expected = options.expectedExitCodes ?? [0]

  const proc = Bun.spawn({
    cmd: command,
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill()
    } catch {
      // noop
    }
  }, timeoutMs)

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  clearTimeout(timer)
  const result: ReliabilityCommandResult = {
    command,
    cwd,
    exitCode,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    timedOut,
  }

  if (!expected.includes(exitCode)) {
    throw new Error(
      [
        `Command failed: ${stringifyCommand(command)}`,
        `cwd: ${cwd}`,
        `exitCode: ${exitCode}`,
        `expected: ${expected.join(", ")}`,
        timedOut ? `timedOut: true` : "",
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  return result
}

export async function waitForPort(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const open = await isPortOpen(host, port)
    if (open) return true
    // eslint-disable-next-line no-await-in-loop
    await sleep(200)
  }
  return false
}

export async function isPortOpen(host: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 1_000)

    socket.once("connect", () => {
      clearTimeout(timeout)
      socket.end()
      resolve(true)
    })
    socket.once("error", () => {
      clearTimeout(timeout)
      resolve(false)
    })
  })
}

export async function waitForHttpJson(
  url: string,
  timeoutMs: number,
  intervalMs = 500,
): Promise<any> {
  const deadline = Date.now() + timeoutMs
  let lastError = "request not attempted"

  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.min(intervalMs, 5_000)) })
      if (res.ok) {
        // eslint-disable-next-line no-await-in-loop
        return await res.json()
      }
      lastError = `HTTP ${res.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError}`)
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function listZeeProcesses(): Promise<Array<{ pid: number; command: string }>> {
  if (process.platform === "win32") {
    const out = await runCommand(
      ["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Depth 3"],
      {
        timeoutMs: 15_000,
      },
    )
    const parsed = JSON.parse(out.stdout || "[]")
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows
      .map((row) => ({
        pid: Number(row?.ProcessId),
        command: String(row?.CommandLine || row?.Name || ""),
      }))
      .filter((entry) => Number.isFinite(entry.pid) && entry.command.toLowerCase().includes("zee"))
  }

  const out = await runCommand(["pgrep", "-af", "zee"], {
    timeoutMs: 10_000,
    expectedExitCodes: [0, 1],
  })

  return out.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/)
      if (!match) return undefined
      return {
        pid: Number.parseInt(match[1], 10),
        command: match[2] ?? "",
      }
    })
    .filter((entry): entry is { pid: number; command: string } => Boolean(entry))
}

export function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

export async function tryRead(filepath: string): Promise<string | null> {
  try {
    return await fs.readFile(filepath, "utf-8")
  } catch {
    return null
  }
}

export async function copyIfExists(source: string, destination: string): Promise<boolean> {
  try {
    await fs.access(source)
  } catch {
    return false
  }
  await ensureDir(path.dirname(destination))
  await fs.copyFile(source, destination)
  return true
}
