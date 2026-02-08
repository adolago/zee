/**
 * LaTeX math detection and extraction utilities.
 *
 * Detects inline ($...$) and block ($$...$$) math expressions in text,
 * splits content into text/math segments for rendering.
 *
 * Regex patterns adapted from marked-katex-extension.
 */

export namespace Latex {
  export type Segment = { type: "text"; content: string } | { type: "math"; content: string }

  // Block math: $$...$$ (can span multiple lines)
  // Captures content between $$ delimiters, excluding leading/trailing whitespace
  const BLOCK_MATH_RE = /\$\$([\s\S]+?)\$\$/g

  // Inline math: $...$ (single line, non-greedy)
  // Must not be preceded or followed by $ (to avoid matching $$)
  // Must not start or end with whitespace
  const INLINE_MATH_RE = /(?<!\$)\$(?!\$)(\S(?:[^$]*?\S)?)\$(?!\$)/g

  // Code block/span patterns to skip
  const CODE_BLOCK_RE = /```[\s\S]*?```/g
  const CODE_SPAN_RE = /`[^`]+`/g

  /**
   * Check if a position falls inside a code block or code span.
   */
  function isInsideCode(text: string, pos: number): boolean {
    for (const m of text.matchAll(CODE_BLOCK_RE)) {
      if (m.index !== undefined && pos >= m.index && pos < m.index + m[0].length) return true
    }
    for (const m of text.matchAll(CODE_SPAN_RE)) {
      if (m.index !== undefined && pos >= m.index && pos < m.index + m[0].length) return true
    }
    return false
  }

  /**
   * Check if content contains any math expressions.
   */
  export function hasMath(content: string): boolean {
    BLOCK_MATH_RE.lastIndex = 0
    INLINE_MATH_RE.lastIndex = 0
    return BLOCK_MATH_RE.test(content) || INLINE_MATH_RE.test(content)
  }

  /**
   * Split content into alternating text and block-math segments.
   * Inline math is left in text segments for separate processing.
   *
   * During streaming, incomplete $$ blocks (no closing $$) are treated as text.
   */
  export function splitAtBlockMath(content: string): Segment[] {
    const segments: Segment[] = []
    let lastIndex = 0

    BLOCK_MATH_RE.lastIndex = 0
    for (const match of content.matchAll(BLOCK_MATH_RE)) {
      if (match.index === undefined) continue
      if (isInsideCode(content, match.index)) continue

      const tex = match[1].trim()
      if (!tex) continue

      // Push preceding text
      if (match.index > lastIndex) {
        segments.push({ type: "text", content: content.slice(lastIndex, match.index) })
      }

      segments.push({ type: "math", content: tex })
      lastIndex = match.index + match[0].length
    }

    // Remaining text
    if (lastIndex < content.length) {
      segments.push({ type: "text", content: content.slice(lastIndex) })
    }

    // If no math found, return single text segment
    if (segments.length === 0) {
      segments.push({ type: "text", content })
    }

    return segments
  }

  /**
   * Replace inline math ($...$) in a text segment with the result of `transform`.
   * Code spans and code blocks are preserved as-is.
   */
  export function replaceInlineMath(content: string, transform: (tex: string) => string): string {
    // Build a set of code ranges to skip
    const codeRanges: Array<[number, number]> = []
    for (const m of content.matchAll(CODE_BLOCK_RE)) {
      if (m.index !== undefined) codeRanges.push([m.index, m.index + m[0].length])
    }
    for (const m of content.matchAll(CODE_SPAN_RE)) {
      if (m.index !== undefined) codeRanges.push([m.index, m.index + m[0].length])
    }

    const inCode = (pos: number) => codeRanges.some(([s, e]) => pos >= s && pos < e)

    INLINE_MATH_RE.lastIndex = 0
    return content.replace(INLINE_MATH_RE, (full, tex, offset) => {
      if (inCode(offset)) return full
      return transform(tex)
    })
  }
}
