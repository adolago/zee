---
summary: "Reaction semantics shared across channels"
read_when:
  - Working on reactions in any channel
---
# Reaction tooling

Shared reaction semantics across channels:

- `emoji` is required when adding a reaction.
- `emoji=""` removes the bot's reaction(s) when supported.
- `remove: true` removes the specified emoji when supported (requires `emoji`).

Channel notes:

- **Matrix**: add reactions are supported; reaction removal is connector-dependent.
- **WhatsApp**: empty `emoji` removes the bot reaction; `remove: true` maps to empty emoji (still requires `emoji`).
