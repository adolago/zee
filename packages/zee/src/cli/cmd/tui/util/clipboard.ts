import { $ } from "bun"
import clipboardy from "clipboardy"
import { platform, release, tmpdir } from "os"
import { mkdtemp, rm } from "node:fs/promises"
import path from "path"
import { fileURLToPath } from "node:url"
import { lazy } from "../../../../util/lazy.js"

/**
 * Writes text to clipboard via OSC 52 escape sequence.
 * This allows clipboard operations to work over SSH by having
 * the terminal emulator handle the clipboard locally.
 */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return
  const base64 = Buffer.from(text).toString("base64")
  const osc52 = `\x1b]52;c;${base64}\x07`
  // tmux and screen require DCS passthrough wrapping
  const passthrough = process.env["TMUX"] || process.env["STY"]
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
  process.stdout.write(sequence)
}

// 4MB threshold - leave 1MB margin for the 5MB API limit
const IMAGE_SIZE_THRESHOLD = 4 * 1024 * 1024

const LINUX_IMAGE_MIME_CANDIDATES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
  "image/avif",
] as const

function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png"
    case "image/jpeg":
    case "image/jpg":
      return ".jpg"
    case "image/webp":
      return ".webp"
    case "image/gif":
      return ".gif"
    case "image/bmp":
      return ".bmp"
    case "image/tiff":
      return ".tiff"
    case "image/heic":
      return ".heic"
    case "image/heif":
      return ".heif"
    case "image/avif":
      return ".avif"
    default:
      return ".img"
  }
}

function inferImageMimeFromFilePath(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    case ".gif":
      return "image/gif"
    case ".bmp":
      return "image/bmp"
    case ".tif":
    case ".tiff":
      return "image/tiff"
    case ".heic":
      return "image/heic"
    case ".heif":
      return "image/heif"
    case ".avif":
      return "image/avif"
    case ".svg":
      return "image/svg+xml"
    default:
      return undefined
  }
}

function parseFilePathsFromClipboardText(text: string): string[] {
  const rawLines = text.split(/\r?\n/)
  const lines = rawLines.map((line) => line.trim()).filter((line) => line.length > 0)
  if (lines.length === 0) return []

  // GNOME / Nautilus format:
  // x-special/gnome-copied-files
  // copy|cut
  // file:///path
  // ...
  let startIndex = 0
  if (lines[0] === "x-special/gnome-copied-files" || lines[0] === "x-special/nautilus-clipboard") {
    startIndex = Math.min(2, lines.length)
  }

  const results: string[] = []
  for (const line of lines.slice(startIndex)) {
    if (line.startsWith("#")) continue

    if (line.startsWith("file://")) {
      try {
        results.push(fileURLToPath(line))
      } catch {
        continue
      }
      continue
    }

    // Some clipboards provide plain absolute paths
    if (path.isAbsolute(line)) results.push(line)
  }

  return results
}

function normalizeClipboardType(type: string): string {
  return type.split(";")[0]?.trim() ?? type.trim()
}

function pickPreferredMime(availableTypes: Set<string>, candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    if (availableTypes.has(candidate)) return candidate
  }
  return undefined
}

export namespace Clipboard {
  export interface Content {
    data: string
    mime: string
  }

  export interface ReadOptions {
    /**
     * Only attempt to read images/files from the clipboard.
     * Useful for fast "is there an image?" checks during paste interception.
     */
    imageOnly?: boolean
  }

  /**
   * Compress an image buffer using ImageMagick if it exceeds the size threshold.
   * Returns the original buffer if compression fails or isn't needed.
   */
  async function compressImageIfNeeded(buffer: Buffer, mime: string): Promise<{ data: Buffer; mime: string }> {
    if (buffer.length <= IMAGE_SIZE_THRESHOLD) {
      return { data: buffer, mime }
    }

    // Check if ImageMagick is available
    const magick = Bun.which("magick") || Bun.which("convert")
    if (!magick) {
      console.warn(
        `[clipboard] Image is ${(buffer.length / 1024 / 1024).toFixed(1)}MB but ImageMagick not available for compression`,
      )
      return { data: buffer, mime }
    }

    let tempDir: string | undefined
    tempDir = await mkdtemp(path.join(tmpdir(), "zee-img-"))
    const tmpInput = path.join(tempDir, `input${extensionForMime(mime)}`)
    const tmpOutput = path.join(tempDir, "output.jpg")

    try {
      // Write original image to temp file
      await Bun.write(tmpInput, buffer)

      // Progressive compression: try different quality levels until under threshold
      // Start with high quality JPEG, reduce if needed
      const qualities = [85, 70, 50, 30]
      const resizeSteps = ["100%", "75%", "50%", "25%"]

      for (const resize of resizeSteps) {
        for (const quality of qualities) {
          const cmd = magick.endsWith("convert")
            ? `convert "${tmpInput}" -resize ${resize} -quality ${quality} -strip "${tmpOutput}"`
            : `magick "${tmpInput}" -resize ${resize} -quality ${quality} -strip "${tmpOutput}"`

          await $`sh -c ${cmd}`.nothrow().quiet()

          const outputFile = Bun.file(tmpOutput)
          if (await outputFile.exists()) {
            const compressed = Buffer.from(await outputFile.arrayBuffer())
            if (compressed.length <= IMAGE_SIZE_THRESHOLD && compressed.length > 0) {
              return { data: compressed, mime: "image/jpeg" }
            }
          }
        }
      }

      // If all compression attempts failed, return original with warning
      console.warn(
        `[clipboard] Could not compress image below ${IMAGE_SIZE_THRESHOLD / 1024 / 1024}MB threshold`,
      )
      return { data: buffer, mime }
    } catch (err) {
      console.warn(`[clipboard] Image compression failed:`, err)
      return { data: buffer, mime }
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true })
      }
    }
  }

  async function readLinuxImageFromClipboard(): Promise<{ buffer: Buffer; mime: string } | undefined> {
    const preferWayland = !!process.env["WAYLAND_DISPLAY"]

    const tryWayland = preferWayland && !!Bun.which("wl-paste")
    if (tryWayland) {
      try {
        const typesRaw = await $`wl-paste -l`.nothrow().text()
        const types = new Set(typesRaw.split(/\r?\n/).map(normalizeClipboardType).filter((x) => x.length > 0))

        const imageMime = pickPreferredMime(types, LINUX_IMAGE_MIME_CANDIDATES)
        if (imageMime) {
          try {
            const data = await $`wl-paste -t ${imageMime}`.nothrow().arrayBuffer()
            if (data.byteLength > 0) return { buffer: Buffer.from(data), mime: imageMime }
          } catch {
            // ignore
          }
        }

        if (types.has("text/uri-list")) {
          const uriList = await $`wl-paste -t text/uri-list`.nothrow().text()
          const filePaths = parseFilePathsFromClipboardText(uriList)
          for (const filePath of filePaths) {
            const mime = inferImageMimeFromFilePath(filePath)
            if (!mime || !mime.startsWith("image/")) continue

            try {
              const file = Bun.file(filePath)
              if (!(await file.exists())) continue
              const buffer = Buffer.from(await file.arrayBuffer())
              if (buffer.length === 0) continue
              return { buffer, mime }
            } catch {
              continue
            }
          }
        }
      } catch {
        // ignore and fall back to X11
      }
    }

    const tryX11 = !!process.env["DISPLAY"] && !!Bun.which("xclip")
    if (tryX11) {
      try {
        const targetsRaw = await $`xclip -selection clipboard -t TARGETS -o`.nothrow().text()
        const targets = new Set(targetsRaw.split(/\r?\n/).map(normalizeClipboardType).filter((x) => x.length > 0))

        const imageMime = pickPreferredMime(targets, LINUX_IMAGE_MIME_CANDIDATES)
        if (imageMime) {
          try {
            const data = await $`xclip -selection clipboard -t ${imageMime} -o`.nothrow().arrayBuffer()
            if (data.byteLength > 0) return { buffer: Buffer.from(data), mime: imageMime }
          } catch {
            // ignore
          }
        }

        if (targets.has("text/uri-list")) {
          const uriList = await $`xclip -selection clipboard -t text/uri-list -o`.nothrow().text()
          const filePaths = parseFilePathsFromClipboardText(uriList)
          for (const filePath of filePaths) {
            const mime = inferImageMimeFromFilePath(filePath)
            if (!mime || !mime.startsWith("image/")) continue

            try {
              const file = Bun.file(filePath)
              if (!(await file.exists())) continue
              const buffer = Buffer.from(await file.arrayBuffer())
              if (buffer.length === 0) continue
              return { buffer, mime }
            } catch {
              continue
            }
          }
        }
      } catch {
        // ignore
      }
    }

    return undefined
  }

  export async function read(options: ReadOptions = {}): Promise<Content | undefined> {
    const os = platform()

    if (os === "win32" || release().includes("WSL")) {
      const script =
        "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }"
      const base64 = await $`powershell.exe -NonInteractive -NoProfile -command "${script}"`.nothrow().text()
      if (base64) {
        const imageBuffer = Buffer.from(base64.trim(), "base64")
        if (imageBuffer.length > 0) {
          const compressed = await compressImageIfNeeded(imageBuffer, "image/png")
          return { data: compressed.data.toString("base64"), mime: compressed.mime }
        }
      }
    }

    if (os === "linux") {
      const linuxImage = await readLinuxImageFromClipboard()
      if (linuxImage) {
        const compressed = await compressImageIfNeeded(linuxImage.buffer, linuxImage.mime)
        return { data: compressed.data.toString("base64"), mime: compressed.mime }
      }
    }

    if (options.imageOnly) return undefined

    const text = await clipboardy.read().catch(() => {})
    if (text) {
      return { data: text, mime: "text/plain" }
    }
  }

  const getCopyMethod = lazy(() => {
    const os = platform()

    if (os === "linux") {
      if (process.env["WAYLAND_DISPLAY"] && Bun.which("wl-copy")) {
        return async (text: string) => {
          const proc = Bun.spawn(["wl-copy"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
          proc.stdin.write(text)
          proc.stdin.end()
          await proc.exited.catch(() => {})
        }
      }
      if (Bun.which("xclip")) {
        return async (text: string) => {
          const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
            stdin: "pipe",
            stdout: "ignore",
            stderr: "ignore",
          })
          proc.stdin.write(text)
          proc.stdin.end()
          await proc.exited.catch(() => {})
        }
      }
      if (Bun.which("xsel")) {
        return async (text: string) => {
          const proc = Bun.spawn(["xsel", "--clipboard", "--input"], {
            stdin: "pipe",
            stdout: "ignore",
            stderr: "ignore",
          })
          proc.stdin.write(text)
          proc.stdin.end()
          await proc.exited.catch(() => {})
        }
      }
    }

    if (os === "win32") {
      return async (text: string) => {
        // Pipe via stdin to avoid PowerShell string interpolation ($env:FOO, $(), etc.)
        const proc = Bun.spawn(
          [
            "powershell.exe",
            "-NonInteractive",
            "-NoProfile",
            "-Command",
            "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
          ],
          {
            stdin: "pipe",
            stdout: "ignore",
            stderr: "ignore",
          },
        )

        proc.stdin.write(text)
        proc.stdin.end()
        await proc.exited.catch(() => {})
      }
    }

    return async (text: string) => {
      await clipboardy.write(text).catch(() => {})
    }
  })

  export async function copy(text: string): Promise<void> {
    writeOsc52(text)
    await getCopyMethod()(text)
  }
}
