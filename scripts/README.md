# Model Block List Manager

A CLI tool to manage model and provider visibility using a **deny-list** approach.

## Philosophy

**All models are allowed by default.** This tool only manages what to hide, following the principle of least surprise.

## Installation

```bash
# Make executable
chmod +x scripts/model-block-cli.ts

# Run with bun
bun run scripts/model-block-cli.ts [command]
```

## Commands

### List Current Block List

```bash
bun run scripts/model-block-cli.ts list
```

### Add Model to Block List

```bash
bun run scripts/model-block-cli.ts add-model openai gpt-4o
bun run scripts/model-block-cli.ts add-model google gemini-2.5-flash
```

### Remove Model from Block List

```bash
bun run scripts/model-block-cli.ts remove-model openai gpt-4o
```

### Add Provider to Block List

```bash
bun run scripts/model-block-cli.ts add-provider xai
bun run scripts/model-block-cli.ts add-provider alibaba
```

### Remove Provider from Block List

```bash
bun run scripts/model-block-cli.ts remove-provider xai
```

### Check if Blocked

```bash
bun run scripts/model-block-cli.ts check openai/gpt-4o
bun run scripts/model-block-cli.ts check xai
```

### Apply Block List to Config

```bash
bun run scripts/model-block-cli.ts apply
```

This applies the block list to your active Zee configuration.

### Validate Block List

```bash
bun run scripts/model-block-cli.ts validate
```

## Block List File Location

The tool searches for `model-block-list.jsonc` in this order:

1. `./.zee/model-block-list.jsonc` (project-specific)
2. `~/.config/zee/model-block-list.jsonc` (user config)
3. `~/.zee/model-block-list.jsonc` (legacy user config)

## Example Block List

```jsonc
{
  "blocked_providers": ["xai", "alibaba"],
  "blocked_models": {
    "openai": ["gpt-4o", "gpt-4o-mini"],
    "google": ["gemini-2.5-flash"],
    "anthropic": []
  },
  "_meta": {
    "version": "1.0.0",
    "principle": "Deny-list approach: all models allowed except blocked"
  }
}
```

## Integration with Zee

When you run `apply`, the tool:

1. Adds blocked providers to `disabled_providers`
2. Adds blocked models to each provider's `blacklist`
3. Preserves existing config
4. Deduplicates entries

## Pre-Configured Block List

A default block list is provided at `.zee/model-block-list.jsonc` with deprecated models already listed:

- OpenAI: gpt-4, gpt-4-turbo, gpt-4o, gpt-4o-mini
- Google: gemini-2.5 series
- xAI: grok-2, grok-3 series
- Kimi: kimi-k2-thinking
- Z.AI: glm-4.5, glm-4.6 series

Uncomment entries to activate them.
