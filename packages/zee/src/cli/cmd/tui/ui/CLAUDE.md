# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

The `ui/` directory contains foundational terminal UI primitives for the TUI: dialogs, toasts, spinner animations, status bar, and shared layout constants. These are the building blocks used by higher-level components in `component/` and `routes/`.

See `../CLAUDE.md` for overall TUI architecture, build commands, and path aliases.

## Dialog System

`dialog.tsx` implements a stack-based modal system at zIndex 2000. It auto-saves/restores focus and handles Escape to close.

All dialog components expose a static `.show()` method returning a Promise for async usage:

```typescript
const confirmed = await DialogConfirm.show(dialog, "Title", "Message") // boolean
const text = await DialogPrompt.show(dialog, "Title", { description })  // string | null
DialogAlert.show(dialog, "Title", "Message")                            // void
```

To open a dialog imperatively: `dialog.replace(() => <MyDialog />, onClose, options)`.

## Toast System

`toast.tsx` provides a queued notification system (one toast visible at a time, others queue). Toasts auto-dismiss. Positioned at zIndex 1600.

```typescript
toast.show({ message: "...", variant: "success" })
toast.error(new Error("..."))
```

Variants: `error`, `warning`, `success`, `info` -- each with default durations and theme-derived colors.

## Spinner (`spinner.ts`)

Precomputes animation frames for terminal spinners. Two animation modes:

- **Knight Rider** (`bidirectional`): Highlight bounces back and forth with configurable trail and hold frames
- **Carousel**: Group of active blocks wrapping left-to-right

Key function: `createFrames(options)` returns `string[]` of pre-rendered frames. `createColors(options)` returns a `ColorGenerator` for dynamic coloring. Frames are precomputed for performance -- no real-time calculation during rendering.

## Status Bar (`status-bar.tsx`)

Displays real-time session state: current directory, agent mode (HOLD/RELEASE), active tool name, stream health (stalled/delayed/slow thresholds at 45s/30s), and connectivity indicators for internet, providers, LSP, and MCP.

## Layout Constants (`header-footer.ts`)

Exports `Header` and `Footer` objects with padding, border, and color constants. Also exports `SplitBorder` (uses `"┃"` character). Use these for consistent header/footer styling across views.

## Patterns

**Component structure**: Dialog components follow the pattern of a render function + static `.show()` helper that wraps the component in a Promise via `dialog.replace()`.

**Keyboard handling**: Use `useKeyboard((evt) => { ... })` with `evt.preventDefault()` / `evt.stopPropagation()`. Standard keys: Return to confirm, Escape to cancel (handled by dialog base), arrow keys for navigation.

**Theme colors**: Always use `useTheme()` context. Key mappings: `theme.text` (primary), `theme.textMuted` (hints), `theme.primary` (active/selected), `theme.border` / `theme.borderActive`, `theme.backgroundMenu` (overlays), `theme.success` / `theme.warning` / `theme.error` (status).

**Z-index layering**: Content (default) < Toast (1600) < Dialog (2000).
