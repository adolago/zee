export const STACKED_TILDE_FRAMES = ["~", "~~", "~~~", "~~"] as const
export const STACKED_TILDE_COLUMN_FRAMES = ["~", "~\n~", "~\n~\n~", "~\n~"] as const

export function stackedTildeFrame(tick: number, animated: boolean = true): string {
  if (!animated) return "~"
  const index = Math.abs(tick) % STACKED_TILDE_FRAMES.length
  return STACKED_TILDE_FRAMES[index] ?? "~"
}

export function stackedTildeColumnFrame(tick: number, animated: boolean = true): string {
  if (!animated) return "~"
  const index = Math.abs(tick) % STACKED_TILDE_COLUMN_FRAMES.length
  return STACKED_TILDE_COLUMN_FRAMES[index] ?? "~"
}
