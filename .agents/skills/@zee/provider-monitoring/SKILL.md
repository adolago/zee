---
name: provider-monitoring
description: Monitor AI provider health, diagnose issues, and manage credentials across agent-core and codex CLI.
---

# Provider Monitoring

Monitor AI provider health, diagnose issues, and manage credentials across agent-core and codex CLI.

## Overview

This skill provides comprehensive provider monitoring capabilities:

1. **Health Checks**: Test all configured providers with minimal requests
2. **Error Categorization**: Automatic classification of Auth, RateLimit, Quota, Timeout, etc.
3. **Codex CLI Integration**: Check OpenAI codex provider limits and usage
4. **Credential Management**: View and update provider authentication
5. **System-wide Monitoring**: Unified view of all AI providers

## Quick Start

```bash
# Test all providers
bun run script/provider-health-check.ts

# Test specific provider
bun run script/provider-health-check.ts --provider minimax-coding-plan

# Check codex CLI status
codex features

# View all credentials
agent-core auth list
```

## Health Check Script

Location: `packages/agent-core/script/provider-health-check.ts`

### Usage

```bash
cd packages/agent-core

# Basic test (first model per provider)
bun run script/provider-health-check.ts

# Test all models
bun run script/provider-health-check.ts --all

# JSON output for automation
bun run script/provider-health-check.ts --json

# Only show errors
bun run script/provider-health-check.ts --errors-only

# Custom timeout (seconds)
bun run script/provider-health-check.ts --timeout 60

# Test specific provider
bun run script/provider-health-check.ts --provider zai-coding-plan
```

### Error Categories

| Category | Description | Suggested Action |
|----------|-------------|------------------|
| `AuthError` | Invalid API key or expired token | `agent-core auth login <provider>` |
| `RateLimitError` | Too many requests (429) | Wait and retry; reduce frequency |
| `QuotaError` | Insufficient balance or quota exceeded | Check billing dashboard; add credits |
| `TimeoutError` | Connection or request timeout | Check network; increase timeout |
| `ModelNotFoundError` | Model deprecated or doesn't exist | Check models.dev for alternatives |
| `ServerError` | Provider 5xx errors | Retry later; check provider status |
| `PermissionError` | Insufficient scopes (403) | Re-authenticate with broader scopes |
| `ValidationError` | Invalid parameters (400) | Update provider configuration |
| `NetworkError` | DNS or connection refused | Check internet connection |
| `ConfigError` | Local configuration issue | Verify config.json |

## Codex CLI Integration

The codexbar tool wraps OpenAI's codex CLI for provider monitoring.

### Configuration

Add to `~/.config/agent-core/agent-core.json`:

```json
{
  "zee": {
    "codexbar": {
      "enabled": true,
      "command": "codex",
      "timeoutMs": 30000
    }
  }
}
```

### Checking Codex Status

```bash
# View codex configuration
cat ~/.codex/config.toml

# Check available features
codex features

# Check authentication
cat ~/.codex/auth.json | jq 'keys'

# Test codex with minimal request
codex exec -m gpt-5.2-codex "Say 'pong'"
```

### Codex Provider Limits

Codex CLI authentication can be either API key or OAuth (depends on your setup). Check your local auth shape:

```bash
# Inspect what codex stored locally
jq 'keys' ~/.codex/auth.json

# Usage/billing (browser)
xdg-open https://platform.openai.com/usage
```

## System-wide Provider Status

### Your Active Providers

| Provider | Type | Status | Models |
|----------|------|--------|--------|
| `zai-coding-plan` | API Key | Working | GLM-4.7, GLM-4.5 |
| `minimax-coding-plan` | API Key | Working | MiniMax-M2.1 |
| `kimi-for-coding` | OAuth | Agent-only | K2.5, K2.5-thinking |
| `xai` | API Key | Working | Grok-3-mini |
| `nebius` | API Key | Working | DeepSeek, Llama |
| `google` | API Key | Working | Gemini-2.0-Flash |
| `voyage` | API Key | Working | Embeddings |
| `vllm` | API Key | Working | Local Qwen |
| `minimax` | API Key | TTS only | speech-02-hd |

### Providers with Issues

| Provider | Issue | Resolution |
|----------|-------|------------|
| `anthropic` | Rate limited | Wait and retry |
| `openai` | Quota exceeded | Check billing |
| `gemini-cli` | Insufficient scopes | Re-authenticate |

## Credential Management

### View All Credentials

```bash
# List all auth entries
agent-core auth list

# View raw auth storage
jq 'keys' ~/.local/share/agent-core/auth.json

# Check specific provider
jq '.["zai-coding-plan"]' ~/.local/share/agent-core/auth.json
```

### Add/Update Credentials

```bash
# OAuth providers
agent-core auth login anthropic
agent-core auth login openai
agent-core auth login kimi-for-coding
agent-core auth login gemini-cli

# API key providers
agent-core auth login zai-coding-plan
agent-core auth login minimax-coding-plan
```

### Remove Credentials

```bash
agent-core auth logout <provider-id>
```

## Monitoring Workflows

### Daily Health Check

```bash
#!/bin/bash
# save as: ~/bin/provider-daily-check.sh

cd ~/.local/src/agent-core/packages/agent-core

echo "=== Provider Health Check - $(date) ==="
bun run script/provider-health-check.ts --errors-only

if [ $? -ne 0 ]; then
  echo "Some providers are failing. Check logs."
  # Could send notification here
fi
```

### Provider Dashboard

```bash
# Quick status overview
echo "=== Provider Status ==="
for provider in zai-coding-plan minimax-coding-plan xai nebius google; do
  VALUE=$(jq -r ".[\"$provider\"].key // .[\"$provider\"].access // .[\"$provider\"].token // empty" ~/.local/share/agent-core/auth.json)
  [ -n "$VALUE" ] && echo "OK $provider" || echo "MISSING $provider (no auth)"
done
```

### Automated Monitoring

Use the health check in cron or systemd timer:

```bash
# Add to crontab
crontab -e

# Run every hour, log results
0 * * * * cd ~/.local/src/agent-core/packages/agent-core && bun run script/provider-health-check.ts --json > ~/.local/share/agent-core/provider-health-$(date +\%Y\%m\%d-\%H).json 2>/dev/null
```

## Integration with Codexbar

The codexbar tool allows agent-core to interact with OpenAI codex CLI:

```typescript
// Example: Check codex status from agent-core
import { resolveCodexbarConfig, runCodexbar } from "./codexbar";

const config = resolveCodexbarConfig();
if (config.enabled) {
  const result = runCodexbar(["features"], config);
  console.log(result.stdout);
}
```

### Use Cases

1. **Unified Provider View**: See all providers (agent-core + codex) in one place
2. **Cross-CLI Authentication**: Share auth status between tools
3. **Usage Tracking**: Monitor spend across multiple interfaces
4. **Failover Logic**: Switch between agent-core and codex providers

## Troubleshooting

### Provider Timing Out

```bash
# Increase timeout
bun run script/provider-health-check.ts --timeout 120

# Test with curl directly
curl -s -X POST "https://api.minimax.io/anthropic/v1/messages" \
  -H "x-api-key: $(jq -r '.["minimax-coding-plan"].key' ~/.local/share/agent-core/auth.json)" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"MiniMax-M2.1","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'
```

### Auth Issues

```bash
# Clear and re-auth
agent-core auth logout <provider>
agent-core auth login <provider>

# Check auth file permissions
ls -la ~/.local/share/agent-core/auth.json
```

### Model Not Found

```bash
# Check available models
curl -s "https://models.dev/api.json" | jq '.["<provider-id>"].models | keys'
```

## References

- [Provider Rosetta Stone](../../../docs/PROVIDER_ROSETTA_STONE.md) - Complete provider reference
- [Health Check Script](../../../packages/agent-core/script/provider-health-check.ts)
- [Codexbar Tool](../../../src/domain/zee/codexbar.ts)
- [models.dev API](https://models.dev/api.json) - Provider and model definitions
