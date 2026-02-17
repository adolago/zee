import { MarkdownRenderable } from "@opentui/core"

const PATCH_FLAG = Symbol.for("zee.tui.markdown-link-dedupe.patch")

function normalizeLinkValue(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim().replace(/^<|>$/g, "")
}

/**
 * OpenTUI renders conceal-mode links as "label (url)".
 * When label and URL are identical this looks broken ("url (url)").
 * Patch the inline renderer once to avoid that duplication.
 */
export function installMarkdownLinkDedupePatch() {
  const proto = MarkdownRenderable.prototype as unknown as Record<string | symbol, unknown>
  if (!proto || typeof proto.renderInlineToken !== "function") return
  if (proto[PATCH_FLAG]) return

  const original = proto.renderInlineToken as (this: any, token: any, chunks: any[]) => void

  proto.renderInlineToken = function patchedRenderInlineToken(this: any, token: any, chunks: any[]) {
    if (this?._conceal && token?.type === "link") {
      const href = normalizeLinkValue(token.href)
      const label = normalizeLinkValue(token.text)

      if (href && label && href === label) {
        const children = Array.isArray(token.tokens) ? token.tokens : []
        if (children.length > 0) {
          for (const child of children) {
            this.renderInlineTokenWithStyle(child, chunks, "markup.link.label")
          }
        } else {
          chunks.push(this.createChunk(label, "markup.link.label"))
        }
        return
      }
    }

    return original.call(this, token, chunks)
  }

  Object.defineProperty(proto, PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  })
}
