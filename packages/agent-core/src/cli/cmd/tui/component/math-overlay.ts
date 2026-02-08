/**
 * Shared store for math block image placements.
 *
 * MathBlock components register their rendered images here.
 * A post-process function in app.tsx reads this store and draws
 * the images into the terminal buffer.
 */

import type { LatexRender } from "@tui/util/latex-render"

export namespace MathOverlay {
  const pending = new Map<number, LatexRender.RenderResult>()

  /**
   * Register a rendered math image for overlay drawing.
   */
  export function register(id: number, result: LatexRender.RenderResult): void {
    pending.set(id, result)
  }

  /**
   * Unregister a math image (cleanup on component unmount).
   */
  export function unregister(id: number): void {
    pending.delete(id)
  }

  /**
   * Get all pending image placements.
   */
  export function entries(): IterableIterator<[number, LatexRender.RenderResult]> {
    return pending.entries()
  }

  /**
   * Check if there are any pending images.
   */
  export function hasPending(): boolean {
    return pending.size > 0
  }

  /**
   * Clear all pending images.
   */
  export function clear(): void {
    pending.clear()
  }
}
