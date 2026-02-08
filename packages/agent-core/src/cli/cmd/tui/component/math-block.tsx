/**
 * MathBlock component: renders block LaTeX ($$...$$) expressions.
 *
 * Rendering pipeline:
 * 1. Shows Unicode fallback text immediately
 * 2. Triggers async MathJax SVG -> PNG render in background
 * 3. When Kitty graphics supported: overlays pixel-perfect image
 * 4. When not supported: draws half-block grayscale via post-process function
 *
 * The component reserves vertical space with a <box> placeholder.
 * Rendered images are stored in a shared store and drawn by a post-process
 * function registered in the app.
 */

import { createSignal, createEffect, on, onCleanup, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { LatexUnicode } from "@tui/util/latex-unicode"
import { LatexRender } from "@tui/util/latex-render"
import { KittyGraphics } from "@tui/util/kitty-graphics"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { MathOverlay } from "./math-overlay"

export interface MathBlockProps {
  tex: string
  maxWidth?: number
}

export function MathBlock(props: MathBlockProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()

  // Unicode fallback -- always available
  const unicodeFallback = () => LatexUnicode.convert(props.tex)

  // Render state
  const [renderState, setRenderState] = createSignal<"pending" | "rendering" | "ready" | "error">(
    "pending",
  )
  const [renderResult, setRenderResult] = createSignal<LatexRender.RenderResult | null>(null)
  const [imageId] = createSignal(KittyGraphics.allocId())

  // Computed max width in cells (leave margin for padding)
  const maxWidthCells = () => props.maxWidth ?? Math.max(20, dimensions().width - 6)

  // Debounced render trigger
  let renderTimeout: ReturnType<typeof setTimeout> | undefined

  createEffect(
    on(
      () => [props.tex, maxWidthCells()] as const,
      ([tex, width]) => {
        if (!tex.trim()) return

        clearTimeout(renderTimeout)
        setRenderState("pending")

        // Debounce during streaming (100ms)
        renderTimeout = setTimeout(async () => {
          setRenderState("rendering")
          try {
            const result = await LatexRender.render(tex, width, theme.text, theme.background)
            setRenderResult(result)
            setRenderState("ready")

            // If Kitty supported, write the image directly to stdout
            if (KittyGraphics.supported()) {
              const seq = KittyGraphics.encode(
                result.png,
                imageId(),
                result.cellCols,
                result.cellRows,
              )
              // Write Kitty graphics after next frame
              process.stdout.write(seq)
            }

            renderer.requestRender()
          } catch {
            setRenderState("error")
          }
        }, 100)
      },
    ),
  )

  onCleanup(() => {
    clearTimeout(renderTimeout)
    // Clean up Kitty image if one was placed
    if (KittyGraphics.supported() && renderResult()) {
      process.stdout.write(KittyGraphics.deleteImage(imageId()))
    }
  })

  const result = () => renderResult()
  const isReady = () => renderState() === "ready" && result() !== null

  // Register this block's render data for the post-process overlay
  createEffect(() => {
    const r = result()
    if (!r || !isReady()) return
    if (!KittyGraphics.supported()) {
      // Register for half-block rendering via post-process
      MathOverlay.register(imageId(), r)
    }
  })

  onCleanup(() => {
    MathOverlay.unregister(imageId())
  })

  return (
    <box flexDirection="column" paddingLeft={1} flexShrink={0}>
      <Show
        when={isReady() && !KittyGraphics.supported()}
        fallback={
          <box flexDirection="column">
            <text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
              {unicodeFallback()}
            </text>
          </box>
        }
      >
        {/* Reserve space for half-block rendered image */}
        <box
          id={`math-${imageId()}`}
          height={Math.ceil((result()!.cellRows ?? 1) / 2) + 1}
          width={result()!.cellCols ?? 20}
        >
          <text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
            {unicodeFallback()}
          </text>
        </box>
      </Show>
    </box>
  )
}
