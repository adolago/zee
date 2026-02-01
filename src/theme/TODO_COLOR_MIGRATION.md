# Color System Migration - COMPLETE

**Source of Truth**: [`src/theme/rosetta.ts`](file:///home/artur/.local/src/agent-core/src/theme/rosetta.ts)

## Phase 1: Core Updates - DONE

- [x] **`src/personas/types.ts`** - Uses `personaPalettes.*.primary.hex`
- [x] **`src/agent/personas.ts`** - Theme definitions use rosetta
- [x] **`src/agent/personas/index.ts`** - Persona definitions use rosetta
- [x] **`packages/agent-core/src/cli/style.ts`** - Uses `cliColors` and `personaCliColors`

## Phase 2: TUI Theme Files - DONE

- [x] **`packages/agent-core/src/cli/cmd/tui/context/theme/zee.json`** - Solarized Blue
- [x] **`packages/agent-core/src/cli/cmd/tui/context/theme/stanley.json`** - Solarized Green
- [x] **`packages/agent-core/src/cli/cmd/tui/context/theme/johny.json`** - Solarized Red

## Phase 3: Zee Gateway - DONE

- [x] **`packages/personas/zee/src/terminal/palette.ts`** - ZEE_PALETTE (blue, not orange)
- [x] **`packages/personas/zee/src/tui/theme/theme.ts`** - Solarized blue palette

## Verification

```bash
# Check no legacy colors remain (except in rosetta.ts migrationMap)
grep -rn "#FF5A2D\|#F6C453\|#3F5E99\|#458A5C\|#9E4D42" --include="*.ts" src/ packages/ | grep -v rosetta.ts

# Build verification
bun run typecheck && bun run build
```

## Color Reference

| Persona | Primary (Solarized) | Bright | Dim |
|---------|---------------------|--------|-----|
| Zee     | `#268bd2` (Blue) | `#69c3ff` | `#1a6094` |
| Stanley | `#859900` (Green) | `#b3d900` | `#5a6600` |
| Johny   | `#dc322f` (Red) | `#ff6b6b` | `#9a2422` |

| Semantic | Color (Unified) |
|----------|-----------------|
| Success  | `#2aa198` (Cyan) |
| Warning  | `#b58900` (Yellow) |
| Error    | `#dc322f` (Red) |
| Info     | `#2aa198` (Cyan) |
| Highlight| `#d33682` (Magenta) |
| Background | `#002b36` (Base03) |
| Text     | `#839496` (Base0) |
