# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

The TUI is the interactive terminal interface for Zee. It renders a full-screen app in the terminal using **SolidJS** for reactive state and **@opentui/solid** for terminal rendering. Users select an agent (Zee is the only active persona by default) on the home screen, then enter a session to chat.

## Build and Dev

From `packages/zee/`:

```bash
bun dev                    # Run dev mode (uses source directly)
bun run build              # Build production binary
bun test                   # Run tests (no TUI-specific tests yet)
bun run typecheck          # Type check with tsgo
```

After building, verify the binary: `./script/verify-binary.sh`

## Path Aliases

Defined in `packages/zee/tsconfig.json`:

- `@tui/*` -> `src/cli/cmd/tui/*` (this directory)
- `@/*` -> `src/*` (package root)
- `@zee/sdk` -> `src/pkg/sdk/client`
- `@root/*` -> `../../src/*` (monorepo src root)
- `@personas/*` -> `../../src/personas/*`

## Architecture

### Rendering

JSX components render to terminal primitives via `@opentui/core` + `@opentui/solid`. Think `<box>`, `<text>`, `<scrollbox>` instead of DOM elements. The JSX import source is `@opentui/solid`, not React.

### Context Provider Tree

All state flows through a deeply nested provider tree in `app.tsx`. The `createSimpleContext` helper in `context/helper.tsx` is the standard pattern: it creates a typed context + provider pair with an `init` function and optional `ready` gate.

To add new global state: create a context file using `createSimpleContext`, add the provider to the tree in `app.tsx`.

### Key Contexts

| Context | Purpose |
|---------|---------|
| `sync` | Real-time data from daemon (sessions, messages, config, providers) |
| `local` | UI-local state (selected agent, model, mode) |
| `sdk` | Client connection to daemon API |
| `kv` | Persistent user preferences |
| `route` | Navigation between home and session views |
| `keybind` | Keyboard shortcut resolution (parses keybind config strings) |
| `vim` | Vim mode state (normal/insert/visual) |
| `theme` | Current theme colors, 39+ built-in themes in `context/theme/` |

### Routes

Two routes: `home` (agent selection) and `session` (conversation view). The session route at `routes/session/index.tsx` is the largest file (~2100 lines) -- it handles message rendering, streaming, tool call visualization, diffs, markdown, and all session interaction.

### Daemon Communication

The TUI does not run AI directly. It connects to the Zee daemon via the SDK client (`context/sdk.tsx`). A background worker (`worker.ts`) handles RPC and event forwarding from the daemon's GlobalBus.

### Dialog System

`ui/dialog.tsx` provides a base dialog context. Dialogs are stacked and managed centrally. Individual dialog components live in `component/dialog-*.tsx` and `ui/dialog-*.tsx`.

### Prompt Input

The prompt system in `component/prompt/` includes autocomplete, frecency-ranked suggestions, command history, and stash (save/restore drafts). It supports vim keybindings defined in `util/vim-commands.ts`.

## Conventions

- No emojis in code, comments, or user-facing text
- Use `createSimpleContext` for new context providers
- Keybinds are string-encoded (e.g., `"ctrl+k"`) and parsed by `@/util/keybind`
- Themes are JSON files in `context/theme/`; persona-specific themes exist (zee.json, stanley.json, johny.json)
