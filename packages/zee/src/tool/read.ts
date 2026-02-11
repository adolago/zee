import z from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import { assertExternalDirectory } from "./external-directory"
import { PermissionNext } from "../permission/next"
import { InstructionPrompt } from "../session/instruction"
import { readTextLinesBounded } from "../util/read-lines-bounded"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_BYTES = 50 * 1024

/**
 * Check if a filename is a .env file that should be blocked for security.
 * This is a hardcoded check that cannot be overridden by config.
 *
 * Blocked patterns:
 * - .env (exact)
 * - .env.* (e.g., .env.local, .env.production)
 * - *.env (e.g., config.env)
 * - *.env.* (e.g., config.env.local)
 *
 * Allowed patterns (safe to read):
 * - .env.example, .env.sample, .env.template
 * - *.env.example, *.env.sample, *.env.template
 * - .envrc (direnv config, not secrets)
 */
function isBlockedEnvFile(filename: string): boolean {
  const base = path.basename(filename).toLowerCase()

  // Allow safe template/example files
  if (base.endsWith(".env.example") || base.endsWith(".env.sample") || base.endsWith(".env.template")) {
    return false
  }

  // Allow .envrc (direnv configuration, not secrets)
  if (base === ".envrc") {
    return false
  }

  // Block .env exact match
  if (base === ".env") {
    return true
  }

  // Block .env.* patterns (e.g., .env.local, .env.production)
  if (base.startsWith(".env.")) {
    return true
  }

  // Block *.env patterns (e.g., config.env)
  if (base.endsWith(".env")) {
    return true
  }

  // Block *.env.* patterns (e.g., config.env.local)
  // Match pattern: something.env.something (but not .env.example etc already handled)
  if (/\.env\.[^.]+$/.test(base) && !base.startsWith(".env.")) {
    return true
  }

  return false
}

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The path to the file to read"),
    offset: z.coerce.number().describe("The line number to start reading from (0-based)").optional(),
    limit: z.coerce.number().describe("The number of lines to read (defaults to 2000)").optional(),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(ctx.directory, filepath)
    }
    const title = path.relative(Instance.worktree, filepath)

    await assertExternalDirectory(ctx, filepath, {
      bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
    })

    // SECURITY: Block .env files containing secrets (hardcoded, cannot be overridden)
    // This is defense-in-depth in case permission rules are misconfigured
    if (isBlockedEnvFile(filepath)) {
      throw new PermissionNext.DeniedError([{ permission: "read", pattern: path.basename(filepath), action: "deny" }])
    }

    // Check permission against both full path and basename
    // This allows patterns like ".env" to match "/path/to/.env"
    const basename = path.basename(filepath)
    await ctx.ask({
      permission: "read",
      patterns: [filepath, basename],
      always: ["*"],
      metadata: {},
    })

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)
      let suggestions: string[] = []
      try {
        const dirEntries = fs.readdirSync(dir)
        suggestions = dirEntries
          .filter(
            (entry) =>
              entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
          )
          .map((entry) => path.join(dir, entry))
          .slice(0, 3)
      } catch {
        // Directory missing/unreadable - fall back to plain not-found error
      }

      if (suggestions.length > 0) {
        throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`)
      }

      throw new Error(`File not found: ${filepath}`)
    }

    const instructions = await InstructionPrompt.resolve(ctx.messages, filepath, ctx.messageID)

    // Exclude SVG (XML-based) and vnd.fastbidsheet (.fbs extension, commonly FlatBuffers schema files)
    const isImage =
      file.type.startsWith("image/") && file.type !== "image/svg+xml" && file.type !== "image/vnd.fastbidsheet"
    const isPdf = file.type === "application/pdf"
    if (isImage || isPdf) {
      const mime = file.type
      const msg = `${isImage ? "Image" : "PDF"} read successfully`
      return {
        title,
        output: msg,
        metadata: {
          preview: msg,
          truncated: false,
          ...(instructions.length > 0 && { loaded: instructions.map((i) => i.filepath) }),
        },
        attachments: [
          {
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            type: "file",
            mime,
            url: `data:${mime};base64,${Buffer.from(await file.bytes()).toString("base64")}`,
          },
        ],
      }
    }

    const isBinary = await isBinaryFile(filepath, file)
    if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`)

    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset || 0
    const read = await readTextLinesBounded({
      filepath,
      offset,
      limit,
      maxBytes: MAX_BYTES,
      maxLineLength: MAX_LINE_LENGTH,
    })
    const raw = read.lines
    const truncatedByBytes = read.truncatedByBytes

    const content = raw.map((line, index) => {
      return `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
    })
    const preview = raw.slice(0, 20).join("\n")

    let output = "<file>\n"
    output += content.join("\n")

    const totalLines = read.totalLines
    const lastReadLine = offset + raw.length
    const hasMoreLines = read.hasMoreLines
    const truncated = hasMoreLines || truncatedByBytes

    if (truncatedByBytes) {
      output += `\n\n(Output truncated at ${MAX_BYTES} bytes. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else if (hasMoreLines) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else {
      output += `\n\n(End of file - total ${totalLines ?? 0} lines)`
    }
    output += "\n</file>"

    // just warms the lsp client
    LSP.touchFile(filepath, false)
    FileTime.read(ctx.sessionID, filepath)

    // Load any new AGENTS.md instructions from the file's directory or parents
    if (instructions.length > 0) {
      output += `\n\n<system-reminder>\n${instructions.map((i) => i.content).join("\n\n")}\n</system-reminder>`
    }

    return {
      title,
      output,
      metadata: {
        preview,
        truncated,
        ...(instructions.length > 0 && { loaded: instructions.map((i) => i.filepath) }),
      },
    }
  },
})

async function isBinaryFile(filepath: string, file: Bun.BunFile): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase()
  // binary check for common non-text extensions
  switch (ext) {
    case ".zip":
    case ".tar":
    case ".gz":
    case ".exe":
    case ".dll":
    case ".so":
    case ".class":
    case ".jar":
    case ".war":
    case ".7z":
    case ".doc":
    case ".docx":
    case ".xls":
    case ".xlsx":
    case ".ppt":
    case ".pptx":
    case ".odt":
    case ".ods":
    case ".odp":
    case ".bin":
    case ".dat":
    case ".obj":
    case ".o":
    case ".a":
    case ".lib":
    case ".wasm":
    case ".pyc":
    case ".pyo":
      return true
    default:
      break
  }

  const stat = await file.stat()
  const fileSize = stat.size
  if (fileSize === 0) return false

  const bufferSize = Math.min(4096, fileSize)
  // Read only a small prefix to avoid loading the entire file into memory.
  const fh = await fs.promises.open(filepath, "r")
  let bytes: Uint8Array
  try {
    const buf = Buffer.alloc(bufferSize)
    const { bytesRead } = await fh.read(buf, 0, bufferSize, 0)
    if (bytesRead === 0) return false
    bytes = buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }

  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++
    }
  }
  // If >30% non-printable characters, consider it binary
  return nonPrintableCount / bytes.length > 0.3
}
