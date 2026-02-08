/**
 * Kitty graphics protocol encoder.
 *
 * Encodes PNG images as Kitty graphics escape sequences for inline
 * image display in supported terminals (WezTerm, Kitty).
 *
 * Protocol reference: https://sw.kovidgoyal.net/kitty/graphics-protocol/
 */

export namespace KittyGraphics {
  const ESC = "\x1b"
  const APC = ESC + "_G"
  const ST = ESC + "\\"

  // Max payload per chunk (4096 bytes of base64 data)
  const CHUNK_SIZE = 4096

  let _supported: boolean | undefined

  /**
   * Detect if the terminal supports Kitty graphics protocol.
   * Checks TERM_PROGRAM env var for known-supported terminals.
   */
  export function supported(): boolean {
    if (_supported !== undefined) return _supported

    const term = process.env.TERM_PROGRAM?.toLowerCase() ?? ""
    const termInfo = process.env.TERM?.toLowerCase() ?? ""

    _supported =
      term === "wezterm" ||
      term === "kitty" ||
      termInfo === "xterm-kitty" ||
      // ghostty also supports kitty graphics
      term === "ghostty"

    return _supported
  }

  /**
   * Reset cached detection (useful for testing).
   */
  export function resetDetection(): void {
    _supported = undefined
  }

  /**
   * Encode a PNG buffer as a Kitty graphics transmission.
   *
   * Uses direct transmission mode (a=T) with PNG format (f=100).
   * Large images are chunked at 4096 bytes per chunk.
   *
   * @param png - Raw PNG image data
   * @param id - Unique image ID (1-4294967295)
   * @param cols - Display width in terminal cells
   * @param rows - Display height in terminal cells
   * @returns Complete escape sequence string
   */
  export function encode(png: Buffer, id: number, cols: number, rows: number): string {
    const data = png.toString("base64")
    const chunks: string[] = []

    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      chunks.push(data.slice(i, i + CHUNK_SIZE))
    }

    if (chunks.length === 0) return ""

    if (chunks.length === 1) {
      // Single chunk: transmit and display in one command
      return `${APC}a=T,f=100,i=${id},c=${cols},r=${rows},q=2;${chunks[0]}${ST}`
    }

    // Multi-chunk: first chunk with m=1 (more data), middle chunks with m=1, last with m=0
    const parts: string[] = []
    parts.push(`${APC}a=T,f=100,i=${id},c=${cols},r=${rows},q=2,m=1;${chunks[0]}${ST}`)

    for (let i = 1; i < chunks.length - 1; i++) {
      parts.push(`${APC}m=1;${chunks[i]}${ST}`)
    }

    parts.push(`${APC}m=0;${chunks[chunks.length - 1]}${ST}`)

    return parts.join("")
  }

  /**
   * Generate a cursor movement + image placement sequence.
   * Moves cursor to (x, y) in terminal cells, then writes the image.
   *
   * @param png - Raw PNG image data
   * @param id - Unique image ID
   * @param x - Column position (0-based)
   * @param y - Row position (0-based)
   * @param cols - Display width in cells
   * @param rows - Display height in cells
   * @returns Complete escape sequence for positioned image
   */
  export function placeAt(
    png: Buffer,
    id: number,
    x: number,
    y: number,
    cols: number,
    rows: number,
  ): string {
    // Save cursor, move to position, write image, restore cursor
    const saveCursor = `${ESC}7`
    const moveTo = `${ESC}[${y + 1};${x + 1}H`
    const restoreCursor = `${ESC}8`
    const imageData = encode(png, id, cols, rows)

    return `${saveCursor}${moveTo}${imageData}${restoreCursor}`
  }

  /**
   * Delete an image by its ID.
   */
  export function deleteImage(id: number): string {
    return `${APC}a=d,d=i,i=${id},q=2;${ST}`
  }

  /**
   * Delete all images.
   */
  export function deleteAll(): string {
    return `${APC}a=d,d=a,q=2;${ST}`
  }

  // Auto-incrementing image ID
  let nextId = 1

  /**
   * Get next unique image ID.
   */
  export function allocId(): number {
    const id = nextId
    nextId = (nextId % 4294967295) + 1
    return id
  }
}
