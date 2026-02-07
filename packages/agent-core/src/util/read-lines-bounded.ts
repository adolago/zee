import { open } from "fs/promises"
import { StringDecoder } from "string_decoder"

export type ReadTextLinesBoundedResult = {
  lines: string[]
  bytesRead: number
  bytesEmitted: number
  truncatedByBytes: boolean
  hasMoreLines: boolean
  totalLines?: number
}

export async function readTextLinesBounded(options: {
  filepath: string
  offset: number
  limit: number
  maxBytes: number
  maxLineLength: number
  chunkSize?: number
}): Promise<ReadTextLinesBoundedResult> {
  const chunkSize = options.chunkSize ?? 64 * 1024
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new Error(`Invalid chunkSize: ${chunkSize}`)
  }

  const fh = await open(options.filepath, "r")
  let bytesRead = 0

  const lines: string[] = []
  let bytesEmitted = 0
  let truncatedByBytes = false
  let hasMoreLines = false
  let totalLines: number | undefined = undefined

  let stopEarly = false
  let lineIndex = 0

  let currentLine = ""
  let currentLineTruncated = false

  const appendToCurrentLine = (part: string) => {
    if (currentLineTruncated) return
    const remaining = options.maxLineLength - currentLine.length
    if (remaining <= 0) {
      currentLineTruncated = true
      return
    }
    if (part.length <= remaining) {
      currentLine += part
      return
    }
    currentLine += part.slice(0, remaining)
    currentLineTruncated = true
  }

  const finalizeCurrentLine = (endedByNewline: boolean) => {
    if (stopEarly) return

    const linePrefix = currentLine
    const wasTruncated = currentLineTruncated
    currentLine = ""
    currentLineTruncated = false

    const shouldInclude = lineIndex >= options.offset && lines.length < options.limit
    if (shouldInclude) {
      const rendered = wasTruncated ? `${linePrefix}...` : linePrefix
      const size = Buffer.byteLength(rendered, "utf-8") + (lines.length > 0 ? 1 : 0)
      if (bytesEmitted + size > options.maxBytes) {
        truncatedByBytes = true
        stopEarly = true
        return
      }

      lines.push(rendered)
      bytesEmitted += size

      // If we hit the requested limit and we saw a newline, we know there are more lines.
      // (Including the split("\n") semantics where a trailing newline yields an extra empty line.)
      if (lines.length === options.limit && endedByNewline) {
        hasMoreLines = true
        stopEarly = true
        return
      }
    }

    lineIndex += 1
  }

  const processChunk = (chunk: string) => {
    let start = 0
    while (!stopEarly) {
      const idx = chunk.indexOf("\n", start)
      if (idx === -1) {
        appendToCurrentLine(chunk.slice(start))
        return
      }
      appendToCurrentLine(chunk.slice(start, idx))
      finalizeCurrentLine(true)
      start = idx + 1
    }
  }

  try {
    const buf = Buffer.alloc(chunkSize)
    const decoder = new StringDecoder("utf8")

    while (!stopEarly) {
      const { bytesRead: readNow } = await fh.read(buf, 0, buf.length, null)
      if (readNow === 0) break
      bytesRead += readNow
      processChunk(decoder.write(buf.subarray(0, readNow)))
    }

    if (!stopEarly) {
      processChunk(decoder.end())
      // Match `text.split("\n")` which always yields a final line, even if empty.
      finalizeCurrentLine(false)
      totalLines = lineIndex
    }
  } finally {
    await fh.close()
  }

  return {
    lines,
    bytesRead,
    bytesEmitted,
    truncatedByBytes,
    hasMoreLines,
    totalLines,
  }
}
