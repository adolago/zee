---
summary: "Use Opencode Zen (curated models) with Zee"
read_when:
  - You want Opencode Zen for model access
  - You want a curated list of coding-friendly models
---
# Opencode Zen

Opencode Zen is a **curated list of models** recommended by the Zee team for coding agents.
It is an optional, hosted model access path that uses an API key and the `opencode` provider.
Zen is currently in beta.

## CLI setup

```bash
zee onboard --auth-choice opencode-zen
# or non-interactive
zee onboard --opencode-zen-api-key "$OPENCODE_ZEN_API_KEY"
```

## Config snippet

```json5
{
  env: { OPENCODE_ZEN_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "opencode/claude-opus-4-5" } } }
}
```

## Notes

- `OPENCODE_ZEN_API_KEY` is also supported.
- You sign in to Zen, add billing details, and copy your API key.
- Opencode Zen bills per request; check the Opencode dashboard for details.
