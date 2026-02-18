const COMBINING_TILDE_ABOVE = "\u0303"
const COMBINING_TILDE_BELOW = "\u0330"
const TILDE_FRAME_HOLD_TICKS = 3

const CENTERED_TILDE_FRAMES = [
  "~",
  `~${COMBINING_TILDE_ABOVE}`,
  `~${COMBINING_TILDE_ABOVE}${COMBINING_TILDE_BELOW}`,
  `~${COMBINING_TILDE_BELOW}`,
] as const

export const STACKED_TILDE_FRAMES = CENTERED_TILDE_FRAMES
export const STACKED_TILDE_COLUMN_FRAMES = CENTERED_TILDE_FRAMES

function frameIndexFromTick(tick: number, frameCount: number): number {
  const heldTick = Math.floor(Math.abs(tick) / TILDE_FRAME_HOLD_TICKS)
  return heldTick % frameCount
}

export function stackedTildeFrame(tick: number, animated: boolean = true): string {
  if (!animated) return "~"
  const index = frameIndexFromTick(tick, STACKED_TILDE_FRAMES.length)
  return STACKED_TILDE_FRAMES[index] ?? "~"
}

export function stackedTildeColumnFrame(tick: number, animated: boolean = true): string {
  if (!animated) return "~"
  const index = frameIndexFromTick(tick, STACKED_TILDE_COLUMN_FRAMES.length)
  return STACKED_TILDE_COLUMN_FRAMES[index] ?? "~"
}
