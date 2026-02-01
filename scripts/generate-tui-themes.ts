#!/usr/bin/env bun
/**
 * Generate TUI theme JSON files from rosetta.ts (single source of truth)
 *
 * Usage: bun scripts/generate-tui-themes.ts
 */

import { writeFileSync } from "fs";
import { join } from "path";
import {
  solarized,
  semantic,
  personaPalettes,
  type PersonaId,
} from "../src/theme/rosetta.ts";

const THEME_DIR = join(
  import.meta.dir,
  "../packages/agent-core/src/cli/cmd/tui/context/theme"
);

interface ThemeDefs {
  [key: string]: string;
}

interface ThemeValue {
  dark: string;
  light: string;
}

interface ThemeConfig {
  defs: ThemeDefs;
  theme: Record<string, ThemeValue>;
}

function generateTheme(personaId: PersonaId): ThemeConfig {
  const persona = personaPalettes[personaId];
  const prefix = personaId;

  const defs: ThemeDefs = {
    // Solarized base
    base03: solarized.base03.hex,
    base02: solarized.base02.hex,
    base01: solarized.base01.hex,
    base00: solarized.base00.hex,
    base0: solarized.base0.hex,
    base1: solarized.base1.hex,
    base2: solarized.base2.hex,
    base3: solarized.base3.hex,
    // Solarized accents
    solYellow: solarized.yellow.hex,
    solOrange: solarized.orange.hex,
    solRed: solarized.red.hex,
    solMagenta: solarized.magenta.hex,
    solViolet: solarized.violet.hex,
    solBlue: solarized.blue.hex,
    solCyan: solarized.cyan.hex,
    solGreen: solarized.green.hex,
    // Persona-specific
    [`${prefix}Primary`]: persona.primary.hex,
    [`${prefix}PrimaryBright`]: persona.primaryBright.hex,
    [`${prefix}PrimaryDim`]: persona.primaryDim.hex,
    [`${prefix}Secondary`]: persona.secondary.hex,
    [`${prefix}Accent`]: persona.accent.hex,
    [`${prefix}Border`]: persona.border.hex,
    [`${prefix}Glow`]: persona.glow.hex,
    // Semantic
    surface: semantic.surface.hex,
    shadow: semantic.shadow.hex,
    // Light mode
    lightBase: solarized.base3.hex,
    lightText: solarized.base00.hex,
  };

  const theme: Record<string, ThemeValue> = {
    primary: { dark: `${prefix}Primary`, light: `${prefix}PrimaryDim` },
    secondary: { dark: `${prefix}Secondary`, light: `${prefix}PrimaryDim` },
    accent: { dark: `${prefix}Accent`, light: `${prefix}Primary` },
    error: { dark: "solRed", light: "solRed" },
    warning: { dark: "solYellow", light: "solYellow" },
    success: { dark: "solCyan", light: "solCyan" },
    info: { dark: "solCyan", light: "solCyan" },
    text: { dark: "base0", light: "lightText" },
    textMuted: { dark: "base01", light: "base00" },
    background: { dark: "transparent", light: "transparent" },
    backgroundPanel: { dark: "base02", light: "transparent" },
    backgroundElement: { dark: "surface", light: "transparent" },
    backgroundMenu: { dark: "base02", light: "lightBase" },
    border: { dark: "base01", light: "base1" },
    borderActive: { dark: `${prefix}Primary`, light: `${prefix}PrimaryDim` },
    borderSubtle: { dark: "surface", light: "base2" },
    // Diff
    diffAdded: { dark: "solCyan", light: "solCyan" },
    diffRemoved: {
      dark: personaId === "johny" ? `${prefix}Primary` : "solRed",
      light: personaId === "johny" ? `${prefix}PrimaryDim` : "solRed",
    },
    diffContext: { dark: "base01", light: "base00" },
    diffHunkHeader: { dark: "base01", light: "base00" },
    diffHighlightAdded: {
      dark: personaId === "stanley" ? `${prefix}Accent` : "solGreen",
      light: personaId === "stanley" ? `${prefix}Primary` : "solGreen",
    },
    diffHighlightRemoved: {
      dark: personaId === "johny" ? `${prefix}Accent` : "solRed",
      light: personaId === "johny" ? `${prefix}Primary` : "solRed",
    },
    diffAddedBg: { dark: "transparent", light: "transparent" },
    diffRemovedBg: { dark: "transparent", light: "transparent" },
    diffContextBg: { dark: "transparent", light: "transparent" },
    diffLineNumber: { dark: "base01", light: "base00" },
    diffAddedLineNumberBg: { dark: "transparent", light: "transparent" },
    diffRemovedLineNumberBg: { dark: "transparent", light: "transparent" },
    // Markdown
    markdownText: { dark: "base0", light: "lightText" },
    markdownHeading: { dark: `${prefix}Primary`, light: `${prefix}PrimaryDim` },
    markdownLink: { dark: `${prefix}Secondary`, light: `${prefix}PrimaryDim` },
    markdownLinkText: { dark: `${prefix}Accent`, light: `${prefix}Primary` },
    markdownCode: {
      dark: personaId === "stanley" ? `${prefix}Accent` : "solGreen",
      light: personaId === "stanley" ? `${prefix}Primary` : "solGreen",
    },
    markdownBlockQuote: { dark: "base01", light: "solYellow" },
    markdownEmph: { dark: "solYellow", light: "solYellow" },
    markdownStrong: { dark: `${prefix}Accent`, light: `${prefix}Primary` },
    markdownHorizontalRule: { dark: "base01", light: "base00" },
    markdownListItem: {
      dark: `${prefix}Secondary`,
      light: `${prefix}PrimaryDim`,
    },
    markdownListEnumeration: {
      dark: `${prefix}Accent`,
      light: `${prefix}Primary`,
    },
    markdownImage: { dark: `${prefix}Secondary`, light: `${prefix}PrimaryDim` },
    markdownImageText: { dark: `${prefix}Accent`, light: `${prefix}Primary` },
    markdownCodeBlock: { dark: "base0", light: "lightText" },
    // Syntax
    syntaxComment: { dark: "base01", light: "base00" },
    syntaxKeyword: { dark: `${prefix}Primary`, light: `${prefix}PrimaryDim` },
    syntaxFunction: { dark: `${prefix}Accent`, light: `${prefix}Primary` },
    syntaxVariable: {
      dark: personaId === "johny" ? `${prefix}Accent` : "solRed",
      light: personaId === "johny" ? `${prefix}Primary` : "solRed",
    },
    syntaxString: {
      dark: personaId === "stanley" ? `${prefix}Accent` : "solGreen",
      light: personaId === "stanley" ? `${prefix}Primary` : "solGreen",
    },
    syntaxNumber: { dark: "solOrange", light: "solOrange" },
    syntaxType: { dark: "solYellow", light: "solYellow" },
    syntaxOperator: { dark: "solCyan", light: "solCyan" },
    syntaxPunctuation: { dark: "base0", light: "lightText" },
  };

  return { defs, theme };
}

const personas: PersonaId[] = ["zee", "stanley", "johny"];

for (const personaId of personas) {
  const config = generateTheme(personaId);
  const path = join(THEME_DIR, `${personaId}.json`);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  console.log(`Generated ${path}`);
}

console.log("Done. All themes generated from rosetta.ts");
