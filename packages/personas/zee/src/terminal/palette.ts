/**
 * Zee CLI Palette - Solarized Dark Blue
 *
 * MIGRATED from legacy "Lobster" orange palette to proper Solarized Blue.
 * Zee is the Blue Team persona - no more orange/red accents.
 *
 * Keep in sync with src/theme/rosetta.ts (single source of truth).
 */
export const ZEE_PALETTE = {
  accent: "#268bd2",
  accentBright: "#69c3ff",
  accentDim: "#1a6094",
  info: "#2aa198",
  success: "#2aa198",
  warn: "#b58900",
  error: "#dc322f",
  muted: "#586e75",
} as const;

/** @deprecated Use ZEE_PALETTE instead. Kept for backward compatibility. */
export const LOBSTER_PALETTE = ZEE_PALETTE;
