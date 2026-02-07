#!/usr/bin/env bun

import fs from "fs"
import os from "os"
import path from "path"
import { readTextLinesBounded } from "../../src/util/read-lines-bounded"

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a?.startsWith("--")) continue
    const key = a.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith("--")) {
      args[key] = "true"
      continue
    }
    args[key] = value
    i++
  }
  return args
}

async function ensureFileBytes(filepath: string, bytes: number) {
  try {
    const st = fs.statSync(filepath)
    if (st.isFile() && st.size >= bytes) return
  } catch {}

  fs.mkdirSync(path.dirname(filepath), { recursive: true })
  const ws = fs.createWriteStream(filepath, { flags: "w" })
  const line = "0123456789abcdef".repeat(8) + "\n" // 129 bytes
  const chunk = line.repeat(8192) // ~1MB
  let written = 0
  while (written < bytes) {
    const remaining = bytes - written
    const data = remaining >= Buffer.byteLength(chunk) ? chunk : chunk.slice(0, remaining)
    if (!ws.write(data)) {
      await new Promise<void>((resolve) => ws.once("drain", () => resolve()))
    }
    written += Buffer.byteLength(data)
  }
  await new Promise<void>((resolve, reject) => {
    ws.end(() => resolve())
    ws.on("error", reject)
  })
}

const args = parseArgs(process.argv.slice(2))

const sizeMb = Number(args["size-mb"] ?? "50")
const maxBytes = Number(args["max-bytes"] ?? String(256 * 1024))
const limit = Number(args["limit"] ?? "200")
const maxLineLength = Number(args["max-line-length"] ?? "2000")

if (!Number.isFinite(sizeMb) || sizeMb <= 0) throw new Error("invalid --size-mb")
if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("invalid --max-bytes")
if (!Number.isFinite(limit) || limit <= 0) throw new Error("invalid --limit")
if (!Number.isFinite(maxLineLength) || maxLineLength <= 0) throw new Error("invalid --max-line-length")

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "agent-core-bench-read-"))
const filepath = args["path"] ? path.resolve(args["path"]) : path.join(tmpBase, "big.txt")
const targetBytes = Math.floor(sizeMb * 1024 * 1024)

console.log(`bench: readTextLinesBounded`)
console.log(`- file: ${filepath}`)
console.log(`- size: ${sizeMb} MB`)
console.log(`- maxBytes: ${maxBytes}`)
console.log(`- limit: ${limit}`)
console.log(`- maxLineLength: ${maxLineLength}`)

await ensureFileBytes(filepath, targetBytes)

const rssBefore = process.memoryUsage().rss
const t0 = performance.now()
const result = await readTextLinesBounded({
  filepath,
  offset: 0,
  limit,
  maxBytes,
  maxLineLength,
})
const t1 = performance.now()
const rssAfter = process.memoryUsage().rss

console.log("")
console.log(`result:`)
console.log(`- lines: ${result.lines.length}`)
console.log(`- bytesRead: ${result.bytesRead}`)
console.log(`- bytesEmitted: ${result.bytesEmitted}`)
console.log(`- truncatedByBytes: ${result.truncatedByBytes}`)
console.log(`- hasMoreLines: ${result.hasMoreLines}`)
console.log(`- timeMs: ${(t1 - t0).toFixed(2)}`)
console.log(`- rssDeltaBytes: ${rssAfter - rssBefore}`)
