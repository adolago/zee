export const STACKED_TILDE_FRAMES = ["~", "~~", "~~~", "~~"] as const

export function stackedTildeFrame(tick: number, animated: boolean = true): string {
  if (!animated) return "~"
  const index = Math.abs(tick) % STACKED_TILDE_FRAMES.length
  return STACKED_TILDE_FRAMES[index] ?? "~"
}
