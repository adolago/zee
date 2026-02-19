const PROMPT_SPINNER_FRAME_HOLD_TICKS = 3
const PROMPT_SPINNER_SPEED_MULTIPLIER = 1.25

// Classic braille dot-cluster spinner (same visual style as "⠋⠙⠹...").
const BRAILLE_DOT_CLUSTER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const
// A one-dot trailing column to widen each frame by one dot-column.
const BRAILLE_DOT_TRAILING_COLUMN_FRAMES = ["⠁", "⠂", "⠂", "⠄", "⡀", "⠠", "⠐", "⠈", "⠈", "⠁"] as const
// Second trailing one-dot column for a total width of three braille cells.
const BRAILLE_DOT_TRAILING_COLUMN_2_FRAMES = ["⠁", "⠁", "⠂", "⠂", "⠄", "⡀", "⠠", "⠐", "⠈", "⠈"] as const
const BRAILLE_DOT_CLUSTER_WIDE_FRAMES = BRAILLE_DOT_CLUSTER_FRAMES.map(
  (frame, index) =>
    `${frame}${BRAILLE_DOT_TRAILING_COLUMN_FRAMES[index] ?? ""}${BRAILLE_DOT_TRAILING_COLUMN_2_FRAMES[index] ?? ""}`,
)

export const PROMPT_SPINNER_FRAMES = BRAILLE_DOT_CLUSTER_WIDE_FRAMES
export const PROMPT_SPINNER_COLUMN_FRAMES = BRAILLE_DOT_CLUSTER_WIDE_FRAMES

function frameIndexFromTick(tick: number, frameCount: number): number {
  const heldTick = Math.floor((Math.abs(tick) * PROMPT_SPINNER_SPEED_MULTIPLIER) / PROMPT_SPINNER_FRAME_HOLD_TICKS)
  return heldTick % frameCount
}

export function promptSpinnerFrame(tick: number, animated: boolean = true): string {
  if (!animated) return "~"
  const index = frameIndexFromTick(tick, PROMPT_SPINNER_FRAMES.length)
  return PROMPT_SPINNER_FRAMES[index] ?? "~"
}

export function promptSpinnerColumnFrame(tick: number, animated: boolean = true): string {
  if (!animated) return "~"
  const index = frameIndexFromTick(tick, PROMPT_SPINNER_COLUMN_FRAMES.length)
  return PROMPT_SPINNER_COLUMN_FRAMES[index] ?? "~"
}
