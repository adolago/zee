#!/usr/bin/env npx tsx
/**
 * agents-menu CLI
 *
 * Usage:
 *   npx tsx agents-menu.ts
 */

const menu = [
  {
    name: "Zee",
    handle: "@zee",
    domain: "Personal, coordination",
    notes: "Default lead persona",
  },
  {
    name: "Stanley",
    handle: "@stanley",
    domain: "Trading, markets",
    notes: "OpenBB + Nautilus",
  },
  {
    name: "Johny",
    handle: "@johny",
    domain: "Learning, study",
    notes: "External persona (CLI bridge)",
  },
];

console.log(JSON.stringify({ personas: menu }, null, 2));
