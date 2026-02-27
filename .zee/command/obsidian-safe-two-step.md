---
description: Apply Obsidian changes with mandatory preview before write
---

Use the `obsidian-cli` skill and enforce safe two-step mode:

1. Read and preview targets first.
2. Show exact mutating command.
3. Execute only after explicit apply intent.
4. Verify by reading back changed properties/content.

For SB_FTL, default wrappers are:

- `/home/artur/Repositories/zee/.agents/skills/@zee/obsidian-cli/scripts/obsidian-safe-two-step`
- `/home/artur/Repositories/zee/.agents/skills/@zee/obsidian-cli/scripts/study-vault-audit`

User request:

$ARGUMENTS

