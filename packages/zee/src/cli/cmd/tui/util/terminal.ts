import { RGBA } from "@opentui/core"
import { resolveTerminalProbePolicy, type TerminalCapabilityOptions } from "@/cli/terminal-capabilities"

export namespace Terminal {
  export type Colors = Awaited<ReturnType<typeof colors>>
  export type PaletteSnapshot = {
    palette: Array<RGBA | null>
    foreground: RGBA | null
    background: RGBA | null
    isCompletePalette: boolean
  }

  function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)))
  }

  function parseHexComponent(component: string): number | null {
    if (!component || !/^[0-9a-f]+$/i.test(component)) return null
    const parsed = Number.parseInt(component, 16)
    if (Number.isNaN(parsed)) return null
    const max = Math.pow(16, component.length) - 1
    if (max <= 0) return null
    return clampByte((parsed / max) * 255)
  }

  function parseHexColor(colorStr: string): RGBA | null {
    let hex = colorStr.trim()
    if (!hex.startsWith("#")) return null
    hex = hex.slice(1)

    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((ch) => ch + ch)
        .join("")
    }

    if (hex.length !== 6 && hex.length !== 8) return null
    if (!/^[0-9a-f]+$/i.test(hex)) return null

    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255

    if ([r, g, b, a].some(Number.isNaN)) return null
    return RGBA.fromInts(r, g, b, a)
  }

  function parseCssRgbColor(colorStr: string): RGBA | null {
    const match = colorStr.trim().match(/^rgba?\((.*)\)$/i)
    if (!match) return null

    const parts = match[1].split(",").map((part) => part.trim())
    if (parts.length !== 3 && parts.length !== 4) return null

    const parseChannel = (part: string): number | null => {
      if (part.endsWith("%")) {
        const value = Number.parseFloat(part.slice(0, -1))
        if (Number.isNaN(value)) return null
        return clampByte((value / 100) * 255)
      }
      const value = Number.parseFloat(part)
      if (Number.isNaN(value)) return null
      return clampByte(value)
    }

    const parseAlpha = (part: string): number | null => {
      if (part.endsWith("%")) {
        const value = Number.parseFloat(part.slice(0, -1))
        if (Number.isNaN(value)) return null
        return clampByte((value / 100) * 255)
      }
      const value = Number.parseFloat(part)
      if (Number.isNaN(value)) return null
      return value <= 1 ? clampByte(value * 255) : clampByte(value)
    }

    const r = parseChannel(parts[0] ?? "")
    const g = parseChannel(parts[1] ?? "")
    const b = parseChannel(parts[2] ?? "")
    const a = parts[3] === undefined ? 255 : parseAlpha(parts[3])
    if (r === null || g === null || b === null || a === null) return null
    return RGBA.fromInts(r, g, b, a)
  }

  function parseOscColor(colorStr: string): RGBA | null {
    const input = colorStr.trim()
    if (!input) return null

    if (/^rgba?:/i.test(input)) {
      const parts = input.slice(input.indexOf(":") + 1).split("/")
      if (parts.length !== 3 && parts.length !== 4) return null
      const channels = parts.map(parseHexComponent)
      if (channels.some((x) => x === null)) return null
      const [r, g, b] = channels
      const a = channels[3] ?? 255
      if (r === null || g === null || b === null) return null
      return RGBA.fromInts(r, g, b, a)
    }

    if (input.startsWith("#")) {
      return parseHexColor(input)
    }

    if (/^rgba?\(/i.test(input)) {
      return parseCssRgbColor(input)
    }

    return null
  }

  export function parseTerminalColor(colorStr: string): RGBA | null {
    return parseOscColor(colorStr)
  }

  function toRgba(color: RGBA | string | null | undefined): RGBA | null {
    if (!color) return null
    if (color instanceof RGBA) return color
    return parseTerminalColor(color)
  }

  function normalizePalette(
    colors: Array<RGBA | string | null | undefined>,
    size: number,
  ): Array<RGBA | null> {
    return Array.from({ length: size }, (_, index) => toRgba(colors[index]))
  }

  function isPaletteComplete(palette: Array<RGBA | null>, size: number): boolean {
    for (let i = 0; i < size; i++) {
      if (!palette[i]) return false
    }
    return true
  }

  function sameRgba(a: RGBA | null, b: RGBA | null): boolean {
    if (!a && !b) return true
    if (!a || !b) return false
    return (
      Math.abs(a.r - b.r) < 0.0001 &&
      Math.abs(a.g - b.g) < 0.0001 &&
      Math.abs(a.b - b.b) < 0.0001 &&
      Math.abs(a.a - b.a) < 0.0001
    )
  }

  export function snapshotFromPaletteProbe(
    probe: {
      palette: Array<string | null | undefined>
      defaultForeground?: string | null
      defaultBackground?: string | null
    },
    size = 16,
  ): PaletteSnapshot {
    const palette = normalizePalette(probe.palette, size)
    const foreground = toRgba(probe.defaultForeground ?? null)
    const background = toRgba(probe.defaultBackground ?? null)
    return {
      palette,
      foreground,
      background,
      isCompletePalette: isPaletteComplete(palette, size),
    }
  }

  export function snapshotFromOscProbe(
    probe: {
      background: RGBA | null
      foreground: RGBA | null
      colors: Array<RGBA | null | undefined>
    },
    size = 16,
  ): PaletteSnapshot {
    const palette = normalizePalette(probe.colors, size)
    return {
      palette,
      foreground: toRgba(probe.foreground),
      background: toRgba(probe.background),
      isCompletePalette: isPaletteComplete(palette, size),
    }
  }

  export function mergePaletteSnapshots(
    primary: PaletteSnapshot | null,
    secondary: PaletteSnapshot | null,
    size = 16,
  ): PaletteSnapshot | null {
    if (!primary && !secondary) return null
    const palette = Array.from({ length: size }, (_, index) => primary?.palette[index] ?? secondary?.palette[index] ?? null)
    const foreground = primary?.foreground ?? secondary?.foreground ?? null
    const background = primary?.background ?? secondary?.background ?? null
    return {
      palette,
      foreground,
      background,
      isCompletePalette: isPaletteComplete(palette, size),
    }
  }

  export function samePaletteSnapshot(
    a: PaletteSnapshot | null,
    b: PaletteSnapshot | null,
  ): boolean {
    if (!a && !b) return true
    if (!a || !b) return false
    if (a.isCompletePalette !== b.isCompletePalette) return false
    if (!sameRgba(a.foreground, b.foreground)) return false
    if (!sameRgba(a.background, b.background)) return false
    const size = Math.max(a.palette.length, b.palette.length)
    for (let i = 0; i < size; i++) {
      if (!sameRgba(a.palette[i] ?? null, b.palette[i] ?? null)) return false
    }
    return true
  }

  export function modeFromBackground(background: RGBA | null): "dark" | "light" {
    if (!background) return "dark"
    const { r, g, b } = background
    const scale = r > 1 || g > 1 || b > 1 ? 255 : 1
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / scale
    return luminance > 0.5 ? "light" : "dark"
  }

  export function shouldUseOscColorQueries(
    options: Omit<TerminalCapabilityOptions, "isTTY"> = {},
  ): boolean {
    return resolveTerminalProbePolicy(options).allowOscColorQueries
  }

  export async function backgroundColor(timeoutMs = 1000): Promise<RGBA | null> {
    if (!process.stdin.isTTY) return null
    if (!shouldUseOscColorQueries()) return null

    return new Promise((resolve) => {
      let background: RGBA | null = null
      let responseBuffer = ""
      let timeout: NodeJS.Timeout
      const wasRaw = Boolean(process.stdin.isRaw)

      const cleanup = () => {
        try {
          process.stdin.setRawMode(wasRaw)
        } catch {
          // ignore
        }
        process.stdin.removeListener("data", handler)
        clearTimeout(timeout)
      }

      const handler = (data: Buffer) => {
        responseBuffer += data.toString()
        const bgMatch = responseBuffer.match(/\x1b]11;([^\x07\x1b]+)(?:\x07|\x1b\\)/)
        if (responseBuffer.length > 4096) responseBuffer = responseBuffer.slice(-2048)
        if (!bgMatch) return
        background = parseOscColor(bgMatch[1])
        cleanup()
        resolve(background)
      }

      process.stdin.setRawMode(true)
      process.stdin.on("data", handler)
      process.stdout.write("\x1b]11;?\x07")

      timeout = setTimeout(() => {
        cleanup()
        resolve(background)
      }, timeoutMs)
    })
  }

  /**
   * Query terminal colors including background, foreground, and palette (0-15).
   * Uses OSC escape sequences to retrieve actual terminal color values.
   *
   * Note: OSC 4 (palette) queries may not work through tmux as responses are filtered.
   * OSC 10/11 (foreground/background) typically work in most environments.
   *
   * Returns an object with background, foreground, and colors array.
   * Any query that fails will be null/empty.
   */
  export async function colors(): Promise<{
    background: RGBA | null
    foreground: RGBA | null
    colors: RGBA[]
  }> {
    if (!process.stdin.isTTY) return { background: null, foreground: null, colors: [] }
    if (!shouldUseOscColorQueries()) return { background: null, foreground: null, colors: [] }

    return new Promise((resolve) => {
      let background: RGBA | null = null
      let foreground: RGBA | null = null
      const paletteColors: RGBA[] = []
      let responseBuffer = ""
      let timeout: NodeJS.Timeout
      const wasRaw = Boolean(process.stdin.isRaw)

      const cleanup = () => {
        try {
          process.stdin.setRawMode(wasRaw)
        } catch {
          // ignore
        }
        process.stdin.removeListener("data", handler)
        clearTimeout(timeout)
      }

      const handler = (data: Buffer) => {
        responseBuffer += data.toString()

        // Match OSC 11 (background color)
        const bgMatch = responseBuffer.match(/\x1b]11;([^\x07\x1b]+)(?:\x07|\x1b\\)/)
        if (bgMatch) {
          background = parseOscColor(bgMatch[1])
        }

        // Match OSC 10 (foreground color)
        const fgMatch = responseBuffer.match(/\x1b]10;([^\x07\x1b]+)(?:\x07|\x1b\\)/)
        if (fgMatch) {
          foreground = parseOscColor(fgMatch[1])
        }

        // Match OSC 4 (palette colors)
        const paletteMatches = responseBuffer.matchAll(/\x1b]4;(\d+);([^\x07\x1b]+)(?:\x07|\x1b\\)/g)
        for (const match of paletteMatches) {
          const index = parseInt(match[1])
          const color = parseOscColor(match[2])
          if (color) paletteColors[index] = color
        }

        if (responseBuffer.length > 8192) responseBuffer = responseBuffer.slice(-4096)

        // Return immediately if we have all 16 palette colors
        if (paletteColors.filter((c) => c !== undefined).length === 16) {
          cleanup()
          resolve({ background, foreground, colors: paletteColors })
        }
      }

      process.stdin.setRawMode(true)
      process.stdin.on("data", handler)

      // Query background (OSC 11)
      process.stdout.write("\x1b]11;?\x07")
      // Query foreground (OSC 10)
      process.stdout.write("\x1b]10;?\x07")
      // Query palette colors 0-15 (OSC 4)
      for (let i = 0; i < 16; i++) {
        process.stdout.write(`\x1b]4;${i};?\x07`)
      }

      timeout = setTimeout(() => {
        cleanup()
        resolve({ background, foreground, colors: paletteColors })
      }, 1000)
    })
  }

  export async function getTerminalBackgroundColor(): Promise<"dark" | "light"> {
    const result = await colors()
    return modeFromBackground(result.background)
  }
}
