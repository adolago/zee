export function overlayBottomOffset(height: number): number {
  const scaled = Math.round(height * 0.12)
  return Math.min(10, Math.max(6, scaled))
}
