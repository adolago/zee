/**
 * Block math rendering: TeX -> SVG -> PNG pipeline.
 *
 * Uses `mathjax` (lightweight MathJax v3 wrapper) for TeX-to-SVG conversion,
 * then `@napi-rs/canvas` (Skia) to rasterize SVG to PNG.
 *
 * MathJax produces clean SVG with <path> elements (no fonts, no CSS),
 * which Skia rasterizes reliably.
 */

import type { RGBA } from "@opentui/core"

type CanvasImageLike = {
  src: Buffer | Uint8Array | string
  width: number
  height: number
}

type CanvasContextLike = {
  fillStyle: string
  fillRect: (x: number, y: number, width: number, height: number) => void
  drawImage: (image: CanvasImageLike, x: number, y: number, width?: number, height?: number) => void
  getImageData: (x: number, y: number, width: number, height: number) => { data: Uint8ClampedArray }
}

type CanvasLike = {
  getContext: (kind: "2d") => CanvasContextLike
  toBuffer: (format: "image/png") => Buffer
}

type CanvasModuleLike = {
  createCanvas: (width: number, height: number) => CanvasLike
  Image: new () => CanvasImageLike
}

export namespace LatexRender {
  export interface RenderResult {
    png: Buffer
    width: number
    height: number
    cellCols: number
    cellRows: number
  }

  // Lazy-loaded modules
  let mathjax: any
  let canvas: CanvasModuleLike | undefined

  // LRU cache: tex+width+colors -> result
  const cache = new Map<string, RenderResult>()
  const CACHE_MAX = 100
  const cacheOrder: string[] = []

  function cacheKey(tex: string, maxWidth: number, fg: string, bg: string): string {
    return `${tex}|${maxWidth}|${fg}|${bg}`
  }

  function cacheGet(key: string): RenderResult | undefined {
    const result = cache.get(key)
    if (result) {
      // Move to front
      const idx = cacheOrder.indexOf(key)
      if (idx > -1) cacheOrder.splice(idx, 1)
      cacheOrder.push(key)
    }
    return result
  }

  function cacheSet(key: string, value: RenderResult): void {
    if (cache.size >= CACHE_MAX) {
      const oldest = cacheOrder.shift()
      if (oldest) cache.delete(oldest)
    }
    cache.set(key, value)
    cacheOrder.push(key)
  }

  /**
   * Initialize MathJax (lazy, cached after first call).
   */
  async function initMathJax(): Promise<any> {
    if (mathjax) return mathjax

    try {
      // @ts-ignore -- mathjax has no type declarations
      const MathJax = await import("mathjax")
      mathjax = await MathJax.init({
        loader: { load: ["input/tex", "output/svg"] },
        tex: {
          packages: ["base", "ams", "noundefined"],
        },
        svg: {
          fontCache: "none",
        },
        startup: {
          typesetting: false,
        },
      })
      return mathjax
    } catch (e) {
      throw new Error(`Failed to initialize MathJax: ${e}`)
    }
  }

  /**
   * Load @napi-rs/canvas lazily.
   */
  async function getCanvas(): Promise<CanvasModuleLike> {
    if (canvas) return canvas
    try {
      const canvasModule = "@napi-rs/canvas"
      canvas = (await import(canvasModule)) as CanvasModuleLike
      return canvas
    } catch (e) {
      throw new Error(`Failed to load @napi-rs/canvas: ${e}`)
    }
  }

  /**
   * Convert a TeX string to SVG markup.
   */
  async function texToSvg(tex: string): Promise<string> {
    const mj = await initMathJax()
    const node = mj.tex2svg(tex, { display: true })
    return mj.startup.adaptor.outerHTML(node)
  }

  /**
   * Rasterize SVG to PNG via @napi-rs/canvas (Skia).
   */
  async function svgToPng(
    svgStr: string,
    maxWidthPx: number,
    fgColor: string,
    bgColor: string,
  ): Promise<{ png: Buffer; width: number; height: number }> {
    const { createCanvas, Image } = await getCanvas()

    // Parse viewBox or width/height from SVG to determine intrinsic size
    const viewBoxMatch = svgStr.match(/viewBox="([^"]*)"/)
    const widthMatch = svgStr.match(/width="([\d.]+)(?:ex|em|px)?"/)
    const heightMatch = svgStr.match(/height="([\d.]+)(?:ex|em|px)?"/)

    // MathJax uses 'ex' units; 1ex ~ 8px at normal text size
    const EX_TO_PX = 8

    let svgWidth: number
    let svgHeight: number

    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].split(/\s+/).map(Number)
      svgWidth = (parts[2] ?? 100) * EX_TO_PX
      svgHeight = (parts[3] ?? 20) * EX_TO_PX
    } else {
      svgWidth = (parseFloat(widthMatch?.[1] ?? "20") || 20) * EX_TO_PX
      svgHeight = (parseFloat(heightMatch?.[1] ?? "5") || 5) * EX_TO_PX
    }

    // Scale to fit maxWidth while maintaining aspect ratio
    let scale = 1
    if (svgWidth > maxWidthPx) {
      scale = maxWidthPx / svgWidth
    }
    // Ensure minimum readability
    scale = Math.max(scale, 0.5)

    const renderWidth = Math.ceil(svgWidth * scale)
    const renderHeight = Math.ceil(svgHeight * scale)

    // Inject color and explicit dimensions into SVG
    let coloredSvg = svgStr
    // Replace stroke/fill with foreground color on paths
    coloredSvg = coloredSvg.replace(/fill="currentColor"/g, `fill="${fgColor}"`)
    coloredSvg = coloredSvg.replace(/stroke="currentColor"/g, `stroke="${fgColor}"`)
    // Set explicit width/height on root <svg> for Skia
    coloredSvg = coloredSvg.replace(/<svg([^>]*)>/, `<svg$1 width="${renderWidth}" height="${renderHeight}">`)

    const cvs = createCanvas(renderWidth, renderHeight)
    const ctx = cvs.getContext("2d")

    // Fill background
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, renderWidth, renderHeight)

    // Draw SVG
    const img = new Image()
    img.src = Buffer.from(coloredSvg)
    ctx.drawImage(img, 0, 0, renderWidth, renderHeight)

    const png = cvs.toBuffer("image/png")
    return { png, width: renderWidth, height: renderHeight }
  }

  /**
   * Convert RGBA color to CSS hex string.
   */
  function rgbaToCss(color: RGBA): string {
    if (typeof color === "string") return color
    const r = Math.round(typeof color.r === "number" && color.r <= 1 ? color.r * 255 : (color.r ?? 255))
    const g = Math.round(typeof color.g === "number" && color.g <= 1 ? color.g * 255 : (color.g ?? 255))
    const b = Math.round(typeof color.b === "number" && color.b <= 1 ? color.b * 255 : (color.b ?? 255))
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
  }

  // Approximate cell dimensions (common terminal defaults)
  const CELL_WIDTH_PX = 8
  const CELL_HEIGHT_PX = 16

  /**
   * Render a TeX block expression to PNG.
   *
   * @param tex - LaTeX expression (without $$ delimiters)
   * @param maxWidthCells - Maximum width in terminal cells
   * @param fg - Foreground color (text/formula color)
   * @param bg - Background color
   * @returns Render result with PNG buffer and cell dimensions
   */
  export async function render(tex: string, maxWidthCells: number, fg: RGBA, bg: RGBA): Promise<RenderResult> {
    const fgCss = rgbaToCss(fg)
    const bgCss = rgbaToCss(bg)
    const maxWidthPx = maxWidthCells * CELL_WIDTH_PX
    const key = cacheKey(tex, maxWidthPx, fgCss, bgCss)

    const cached = cacheGet(key)
    if (cached) return cached

    const svgStr = await texToSvg(tex)
    const { png, width, height } = await svgToPng(svgStr, maxWidthPx, fgCss, bgCss)

    const cellCols = Math.ceil(width / CELL_WIDTH_PX)
    const cellRows = Math.ceil(height / CELL_HEIGHT_PX)

    const result: RenderResult = { png, width, height, cellCols, cellRows }
    cacheSet(key, result)
    return result
  }

  /**
   * Convert a rendered PNG to grayscale intensity array for half-block rendering.
   * Returns Float32Array suitable for drawGrayscaleBufferSupersampled.
   */
  export async function pngToGrayscale(
    png: Buffer,
    fg: RGBA,
    bg: RGBA,
  ): Promise<{ intensities: Float32Array; width: number; height: number }> {
    const { createCanvas, Image } = await getCanvas()

    const img = new Image()
    img.src = png
    const w = img.width
    const h = img.height
    const cvs = createCanvas(w, h)
    const ctx = cvs.getContext("2d")
    ctx.drawImage(img, 0, 0)

    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    const intensities = new Float32Array(w * h)

    // Background luminance for contrast calculation
    const bgR = typeof bg.r === "number" && bg.r <= 1 ? bg.r : (bg.r ?? 0) / 255
    const bgG = typeof bg.g === "number" && bg.g <= 1 ? bg.g : (bg.g ?? 0) / 255
    const bgB = typeof bg.b === "number" && bg.b <= 1 ? bg.b : (bg.b ?? 0) / 255
    const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4] / 255
      const g = data[i * 4 + 1] / 255
      const b = data[i * 4 + 2] / 255
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      // Intensity relative to background: 0 = background, 1 = foreground
      intensities[i] = Math.abs(lum - bgLum)
    }

    return { intensities, width: w, height: h }
  }

  /**
   * Check if rendering dependencies are available.
   */
  export async function available(): Promise<boolean> {
    try {
      await initMathJax()
      await getCanvas()
      return true
    } catch {
      return false
    }
  }

  /**
   * Clear the render cache.
   */
  export function clearCache(): void {
    cache.clear()
    cacheOrder.length = 0
  }
}
