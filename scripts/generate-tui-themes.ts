#!/usr/bin/env bun
/**
 * Copy the canonical Selenized Dark TUI theme into the CLI runtime theme folder.
 *
 * Usage: bun scripts/generate-tui-themes.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const SOURCE_THEME = join(import.meta.dir, "../themes/selenized-dark.json")
const TARGET_THEME = join(
  import.meta.dir,
  "../packages/zee/src/cli/cmd/tui/context/theme/selenized-dark.json",
)

const raw = readFileSync(SOURCE_THEME, "utf-8")
const parsed = JSON.parse(raw)
mkdirSync(dirname(TARGET_THEME), { recursive: true })
writeFileSync(TARGET_THEME, JSON.stringify(parsed, null, 2) + "\n")

console.log(`Updated ${TARGET_THEME}`)
