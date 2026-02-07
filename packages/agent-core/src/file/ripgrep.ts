// Ripgrep utility functions
import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { NamedError } from "@agent-core/util/error"
import { lazy } from "../util/lazy"

import { ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js"
import { Log } from "@/util/log"

export namespace Ripgrep {
  const log = Log.create({ service: "ripgrep" })
  const Stats = z.object({
    elapsed: z.object({
      secs: z.number(),
      nanos: z.number(),
      human: z.string(),
    }),
    searches: z.number(),
    searches_with_match: z.number(),
    bytes_searched: z.number(),
    bytes_printed: z.number(),
    matched_lines: z.number(),
    matches: z.number(),
  })

  const Begin = z.object({
    type: z.literal("begin"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
    }),
  })

  export const Match = z.object({
    type: z.literal("match"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      lines: z.object({
        text: z.string(),
      }),
      line_number: z.number(),
      absolute_offset: z.number(),
      submatches: z.array(
        z.object({
          match: z.object({
            text: z.string(),
          }),
          start: z.number(),
          end: z.number(),
        }),
      ),
    }),
  })

  const End = z.object({
    type: z.literal("end"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      binary_offset: z.number().nullable(),
      stats: Stats,
    }),
  })

  const Summary = z.object({
    type: z.literal("summary"),
    data: z.object({
      elapsed_total: z.object({
        human: z.string(),
        nanos: z.number(),
        secs: z.number(),
      }),
      stats: Stats,
    }),
  })

  const Result = z.union([Begin, Match, End, Summary])

  export type Result = z.infer<typeof Result>
  export type Match = z.infer<typeof Match>
  export type Begin = z.infer<typeof Begin>
  export type End = z.infer<typeof End>
  export type Summary = z.infer<typeof Summary>
  const PLATFORM = {
    "arm64-linux": {
      platform: "aarch64-unknown-linux-gnu",
      extension: "tar.gz",
    },
    "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
    "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
  } as const

  export const ExtractionFailedError = NamedError.create(
    "RipgrepExtractionFailedError",
    z.object({
      filepath: z.string(),
      stderr: z.string(),
    }),
  )

  export const UnsupportedPlatformError = NamedError.create(
    "RipgrepUnsupportedPlatformError",
    z.object({
      platform: z.string(),
    }),
  )

  export const DownloadFailedError = NamedError.create(
    "RipgrepDownloadFailedError",
    z.object({
      url: z.string(),
      status: z.number(),
    }),
  )

  export const state = lazy(async () => {
    let filepath = Bun.which("rg")
    if (filepath) return { filepath }
    filepath = path.join(Global.Path.bin, "rg" + (process.platform === "win32" ? ".exe" : ""))

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
      const config = PLATFORM[platformKey]
      if (!config) throw new UnsupportedPlatformError({ platform: platformKey })

      const version = "14.1.1"
      const filename = `ripgrep-${version}-${config.platform}.${config.extension}`
      const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${filename}`

      const response = await fetch(url)
      if (!response.ok) throw new DownloadFailedError({ url, status: response.status })

      const buffer = await response.arrayBuffer()
      const archivePath = path.join(Global.Path.bin, filename)
      await Bun.write(archivePath, buffer)
      if (config.extension === "tar.gz") {
        const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

        if (platformKey.endsWith("-linux")) args.push("--wildcards", "*/rg")

        const proc = Bun.spawn(args, {
          cwd: Global.Path.bin,
          stderr: "pipe",
          stdout: "pipe",
        })
        await proc.exited
        if (proc.exitCode !== 0)
          throw new ExtractionFailedError({
            filepath,
            stderr: await Bun.readableStreamToText(proc.stderr),
          })
      }
      if (config.extension === "zip") {
        const zipFileReader = new ZipReader(new BlobReader(new Blob([await Bun.file(archivePath).arrayBuffer()])))
        const entries = await zipFileReader.getEntries()
        let rgEntry: any
        for (const entry of entries) {
          if (entry.filename.endsWith("rg.exe")) {
            rgEntry = entry
            break
          }
        }

        if (!rgEntry) {
          throw new ExtractionFailedError({
            filepath: archivePath,
            stderr: "rg.exe not found in zip archive",
          })
        }

        const rgBlob = await rgEntry.getData(new BlobWriter())
        if (!rgBlob) {
          throw new ExtractionFailedError({
            filepath: archivePath,
            stderr: "Failed to extract rg.exe from zip archive",
          })
        }
        await Bun.write(filepath, await rgBlob.arrayBuffer())
        await zipFileReader.close()
      }
      await fs.unlink(archivePath)
      if (!platformKey.endsWith("-win32")) await fs.chmod(filepath, 0o755)
    }

    return {
      filepath,
    }
  })

  export async function filepath() {
    const { filepath } = await state()
    return filepath
  }

  export async function* files(input: {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
    signal?: AbortSignal
  }) {
    input.signal?.throwIfAborted()

    const args = [await filepath(), "--files", "--glob=!.git/*"]
    if (input.follow) args.push("--follow")
    if (input.hidden !== false) args.push("--hidden")
    if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`)
    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    // Bun.spawn should throw this, but it incorrectly reports that the executable does not exist.
    // See https://github.com/oven-sh/bun/issues/24012
    if (!(await fs.stat(input.cwd).catch(() => undefined))?.isDirectory()) {
      throw Object.assign(new Error(`No such file or directory: '${input.cwd}'`), {
        code: "ENOENT",
        errno: -2,
        path: input.cwd,
      })
    }

    const proc = Bun.spawn(args, {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "ignore",
      maxBuffer: 1024 * 1024 * 20,
      signal: input.signal,
    })

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        input.signal?.throwIfAborted()

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // Handle both Unix (\n) and Windows (\r\n) line endings
        const lines = buffer.split(/\r?\n/)
        // Keep the last element as buffer (may be incomplete line or empty string)
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          // Only yield non-empty lines
          if (line.length > 0) yield line
        }
      }

      // Flush any remaining decoder state
      buffer += decoder.decode(undefined, { stream: false })
      // Yield remaining buffer content if non-empty
      if (buffer.length > 0) yield buffer
    } finally {
      reader.releaseLock()

      // Kill the process if it's still running to prevent orphaning
      // This happens when consumers break out of the generator early
      try {
        if (proc.exitCode === null) {
          proc.kill()
        }
      } catch {
        // Process may already be dead, ignore errors
      }

      // Wait for process to exit with timeout protection
      const PROCESS_EXIT_TIMEOUT_MS = 5000
      await Promise.race([
        proc.exited,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Process exit timeout")), PROCESS_EXIT_TIMEOUT_MS),
        ),
      ]).catch(() => {
        // Force kill if graceful termination failed
        try {
          proc.kill("SIGKILL")
        } catch {
          // Ignore errors - process may already be dead
        }
      })
    }

    input.signal?.throwIfAborted()
  }

  export async function tree(input: { cwd: string; limit?: number; signal?: AbortSignal }) {
    log.info("tree", input)
    const files = await Array.fromAsync(Ripgrep.files({ cwd: input.cwd, signal: input.signal }))
    interface Node {
      name: string
      children: Map<string, Node>
    }

    function dir(node: Node, name: string) {
      const existing = node.children.get(name)
      if (existing) return existing
      const next = { name, children: new Map() }
      node.children.set(name, next)
      return next
    }

    const root: Node = { name: "", children: new Map() }
    for (const file of files) {
      if (file.includes(".agent-core")) continue
      const parts = file.split(path.sep)
      if (parts.length < 2) continue
      let node = root
      for (const part of parts.slice(0, -1)) {
        node = dir(node, part)
      }
    }

    function count(node: Node): number {
      let total = 0
      for (const child of node.children.values()) {
        total += 1 + count(child)
      }
      return total
    }

    const total = count(root)
    const limit = input.limit ?? total
    const lines: string[] = []
    const queue: { node: Node; path: string }[] = []
    for (const child of Array.from(root.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
      queue.push({ node: child, path: child.name })
    }

    let used = 0
    for (let i = 0; i < queue.length && used < limit; i++) {
      const { node, path: nodePath } = queue[i]
      lines.push(nodePath)
      used++
      for (const child of Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
        queue.push({ node: child, path: `${nodePath}/${child.name}` })
      }
    }

    if (total > used) lines.push(`[${total - used} truncated]`)

    return lines.join("\n")
  }

  export async function search(input: {
    cwd: string
    pattern: string
    glob?: string[]
    limit?: number
    follow?: boolean
    signal?: AbortSignal
  }) {
    // Sentinel: Removed quotes around glob to support Bun.spawn (array args) and fixed command injection.
    const args = [`${await filepath()}`, "--json", "--hidden", "--glob=!.git/*"]
    if (input.follow) args.push("--follow")

    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    if (input.limit) {
      args.push(`--max-count=${input.limit}`)
    }

    args.push("--")
    args.push(input.pattern)

    input.signal?.throwIfAborted()

    const proc = Bun.spawn(args, {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "ignore",
      signal: input.signal,
    })

    // Set up abort handler to kill process if signal is triggered
    const abortHandler = () => {
      try {
        proc.kill()
      } catch {
        // Ignore errors - process may already be dead
      }
    }
    input.signal?.addEventListener("abort", abortHandler, { once: true })

    try {
      const stdout = await new Response(proc.stdout).text()
      const exitCode = await proc.exited

      input.signal?.removeEventListener("abort", abortHandler)

      // Exit code 1 means no matches found, which is fine
      // Exit code 0 means matches found
      // Other non-zero codes indicate an error
      if (exitCode !== 0 && exitCode !== 1) {
        return []
      }

      // Handle both Unix (\n) and Windows (\r\n) line endings
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      // Parse JSON lines from ripgrep output

      return lines
        .map((line) => JSON.parse(line))
        .map((parsed) => Result.parse(parsed))
        .filter((r) => r.type === "match")
        .map((r) => r.data)
    } catch (error) {
      // Clean up abort listener on error
      input.signal?.removeEventListener("abort", abortHandler)
      throw error
    }
  }
}
