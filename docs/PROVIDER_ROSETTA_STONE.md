# Provider Rosetta Stone

Complete reference for zee providers, authentication, and models.

## Quick Reference: Your Active Providers

**Last tested: 2026-02-01**

### Working Providers (Verified)

| Provider ID | Display Name | Auth Type | Status | Use Case |
|-------------|--------------|-----------|--------|----------|
| `google` | Google | API key | **200 OK** | Gemini 2.0 Flash |
| `zai-coding-plan` | Z.AI Coding Plan | API key | **200 OK** | GLM-4.7 |
| `xai` | xAI | API key | **200 OK** | Grok models |
| `nebius` | Nebius Token Factory | API key | **200 OK** | DeepSeek, Llama, Qwen |
| `minimax` | MiniMax (minimax.io) | API key | **200 OK** | **TTS only** |
| `minimax-coding-plan` | MiniMax Coding Plan | API key | **200 OK** | M2.1 chat (free tier) |
| `vllm` | vLLM | API key | **200 OK** | Local inference |
| `voyage` | Voyage AI | API key | **200 OK** | Embeddings, reranking |
| `kimi-for-coding` | Kimi For Coding | OAuth | **Agent-only** | K2.5, K2.5-thinking |

### Providers with Issues

| Provider ID | Display Name | Auth Type | Status | Issue |
|-------------|--------------|-----------|--------|-------|
| `anthropic` | Anthropic | OAuth | Needs re-auth | Rate limit exceeded |
| `openai` | OpenAI | OAuth | Quota exceeded | Check billing |
| `opencode` | Opencode Zen | API key | Insufficient balance | Add credits |

### Provider Notes

- **kimi-for-coding**: Only works via zee TUI, not direct API calls (Kimi restricts to coding agents)
- **anthropic**: OAuth token may need refresh - run `zee auth login anthropic`
- **openai**: Quota exceeded - check billing at https://platform.openai.com/account/billing
- **minimax**: Pay-as-you-go account has no chat balance, but TTS works fine

## Authentication Commands

```bash
# List all credentials
zee auth list

# Login to a provider (interactive)
zee auth login <provider-id>

# Logout from a provider
zee auth logout <provider-id>

# Examples
zee auth login anthropic        # OAuth flow
zee auth login kimi-for-coding  # OAuth flow
zee auth login minimax-coding-plan  # API key prompt
zee auth login zai-coding-plan  # API key prompt
```

## Provider Categories

### Tier 1: Primary Providers (Recommended)

| Provider ID | SDK | Auth Method | Key Models |
|-------------|-----|-------------|------------|
| `anthropic` | @ai-sdk/anthropic | OAuth or API key | Claude 4.5 Opus/Sonnet |
| `openai` | @ai-sdk/openai | OAuth or API key | GPT-5.5, o3, Codex |
| `google` | @ai-sdk/google | API key (AI Studio) | Gemini 3 Pro/Flash |
| `google-antigravity` | @ai-sdk/google | OAuth (Antigravity) | Claude Opus 4.5 Thinking, Gemini 3 |

### Tier 2: Coding Plan Providers (Free/Subscription)

| Provider ID | SDK | Auth | Key Models | Notes |
|-------------|-----|------|------------|-------|
| `kimi-for-coding` | @ai-sdk/openai-compatible | OAuth | K2.5, K2.5-thinking | Free tier available |
| `zai-coding-plan` | @ai-sdk/openai-compatible | API key | GLM-4.7, GLM-4.6 | Free tier available |
| `minimax-coding-plan` | @ai-sdk/anthropic | API key | M2.1, M2.1-lightning | Subscription required |

### Tier 3: Infrastructure Providers

| Provider ID | SDK | Auth | Use Case |
|-------------|-----|------|----------|
| `nebius` | @ai-sdk/openai-compatible | API key | DeepSeek, Llama, Qwen hosting |
| `openrouter` | @openrouter/ai-sdk-provider | API key | Multi-provider routing |
| `vllm` | @ai-sdk/openai-compatible | API key | Local inference |

### Tier 4: Specialty Providers

| Provider ID | SDK | Auth | Use Case |
|-------------|-----|------|----------|
| `xai` | @ai-sdk/xai | API key | Grok models |
| `voyage` | N/A | API key | Embeddings, reranking |
| `minimax` | @ai-sdk/anthropic | API key | TTS only |

## SDK Types

| SDK Package | Protocol | Providers Using It |
|-------------|----------|-------------------|
| `@ai-sdk/anthropic` | Anthropic Messages API | anthropic, minimax, minimax-coding-plan, kimi-for-coding |
| `@ai-sdk/openai` | OpenAI Chat/Responses API | openai |
| `@ai-sdk/google` | Google GenerativeAI | google |
| `@ai-sdk/openai-compatible` | OpenAI-compatible | nebius, zai-coding-plan, deepseek, vllm, etc. |
| `@ai-sdk/xai` | xAI native | xai |
| `@openrouter/ai-sdk-provider` | OpenRouter | openrouter |

## Environment Variables

Each provider can be authenticated via environment variable OR `zee auth login`:

| Provider | Environment Variable |
|----------|---------------------|
| anthropic | `ANTHROPIC_API_KEY` |
| openai | `OPENAI_API_KEY` |
| google | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| xai | `XAI_API_KEY` |
| nebius | `NEBIUS_API_KEY` |
| kimi-for-coding | `KIMI_API_KEY` |
| zai-coding-plan | `ZHIPU_API_KEY` |
| minimax | `MINIMAX_API_KEY` |
| minimax-coding-plan | `MINIMAX_API_KEY` |
| voyage | `VOYAGE_API_KEY` |
| openrouter | `OPENROUTER_API_KEY` |
| vllm | `VLLM_API_KEY` (optional for local) |

## Credential Storage

```
~/.local/share/zee/auth.json
```

### API Key Format
```json
{
  "provider-id": {
    "type": "api",
    "key": "sk-..."
  }
}
```

### OAuth Format
```json
{
  "provider-id": {
    "type": "oauth",
    "access": "eyJ...",      // Access token
    "refresh": "...",        // Refresh token
    "expires": 1234567890    // Expiration timestamp
  }
}
```

## OAuth vs API Key

| Auth Type | Providers | Flow |
|-----------|-----------|------|
| **OAuth** | anthropic, openai, google-antigravity, kimi-for-coding | Browser-based login, auto-refresh tokens |
| **API Key** | Most others | Paste key when prompted |

## MiniMax Special Cases

MiniMax has **multiple providers** with **different API keys**:

| Provider ID | API Key Type | Use Case | Status |
|-------------|--------------|----------|--------|
| `minimax` | Pay-as-you-go | TTS, Video, Image, Music | **Working** (disabled for chat) |
| `minimax-coding-plan` | Coding Plan subscription | M2.1, M2.1-lightning chat | **Working** |
| `minimax-cn` | Pay-as-you-go (China) | Disabled | Disabled |
| `minimax-cn-coding-plan` | Coding Plan (China) | Disabled | Disabled |

### MiniMax API Key Types

```
sk-api-*     = Pay-as-you-go key (starts with sk-api-)
sk-cp-*      = Coding Plan key (starts with sk-cp-)
```

### Your MiniMax Setup

```bash
# Auth entries
zee auth list | grep -i minimax
# ●  MiniMax (minimax.io) api          ← Pay-as-you-go (for TTS)
# ●  MiniMax Coding Plan (minimax.io) api  ← Coding plan (for chat)

# Disabled providers (in config.json)
jq '.disabled_providers | map(select(test("minimax")))' ~/.config/zee/config.json
# ["minimax", "minimax-cn", "minimax-cn-coding-plan"]
# Note: minimax is disabled for chat but still used for TTS
```

### TTS Configuration

TTS is configured in `~/.config/zee/config.json`:

```json
{
  "messages": {
    "tts": {
      "provider": "minimax",
      "auto": "always",
      "minimax": {
        "voice": "moss_audio_bc36b4e7-fca5-11f0-8519-02bb2d7b7c24"
      }
    }
  }
}
```

**Important**: TTS uses the `minimax` (pay-as-you-go) key, NOT the coding plan key.

### Testing MiniMax

```bash
# Test coding plan (chat)
curl -s -X POST "https://api.minimax.io/anthropic/v1/messages" \
  -H "x-api-key: $(jq -r '.["minimax-coding-plan"].key' ~/.local/share/zee/auth.json)" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M2.1","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'

# Test TTS
curl -s -X POST "https://api.minimax.io/v1/t2a_v2" \
  -H "Authorization: Bearer $(jq -r '.minimax.key' ~/.local/share/zee/auth.json)" \
  -H "Content-Type: application/json" \
  -d '{"text":"hello","model":"speech-02-hd","voice_setting":{"voice_id":"Calm_Woman"}}'
```

## Google/Antigravity Special Cases

Google provider supports multiple auth sources:

1. **API Key (AI Studio)**: `GEMINI_API_KEY` or `zee auth login google`
2. **OAuth (Antigravity)**: `zee auth login google-antigravity`

Antigravity models (Claude via Google, Gemini 3) require `google-antigravity` OAuth.

## Disabled Providers

These are disabled in your config (`disabled_providers`):

- `minimax` - No chat balance (kept for TTS)
- `minimax-cn` - China region
- `minimax-cn-coding-plan` - China region

## Provider Blacklist (Hard-coded)

These providers are permanently hidden:

- `nebius` - Permanently disabled
- `venice` - Privacy proxy removed
- `alibaba` - Removed per request
- `synthetic` - Redundant HuggingFace proxy
- `ollama` - Use vLLM instead
- `github-copilot` - Subscription-based
- `amazon-bedrock` - Enterprise AWS only
- `qwen-portal` - OAuth complexity
- `moonshot` - Duplicate of kimi-for-coding
- `google-vertex` - Requires GCP service account
- `google-vertex-anthropic` - Requires GCP service account

## Model Naming Conventions

| Provider | Model ID Pattern | Example |
|----------|-----------------|---------|
| anthropic | `claude-*` | `claude-sonnet-4-5-20250514` |
| openai | `gpt-*`, `o3-*`, `codex-*` | `gpt-5.5-turbo` |
| google | `gemini-*`, `antigravity-*` | `gemini-3-flash` |
| kimi-for-coding | `kimi-k*`, `k2p5` | `kimi-k2.5-thinking` |
| zai-coding-plan | `glm-*` | `glm-4.7` |
| minimax-coding-plan | `MiniMax-M*` | `MiniMax-M2.1` |
| xai | `grok-*` | `grok-4-mini` |

## Troubleshooting

### "No auth configured"
```bash
zee auth login <provider-id>
```

### "Insufficient balance"
- For minimax: Use `minimax-coding-plan` for chat, `minimax` only for TTS
- For pay-as-you-go providers: Add credits to your account

### "Token unusable" / "Authentication error"
- Token expired: `zee auth logout <provider> && zee auth login <provider>`
- Wrong key type: Ensure you're using the correct key for the provider

### OAuth refresh failed
```bash
zee auth logout <provider>
zee auth login <provider>
```

## Health Check

### Quick Curl Tests

```bash
# Z.AI Coding Plan
ZAI_KEY=$(jq -r '.["zai-coding-plan"].key' ~/.local/share/zee/auth.json)
curl -s -X POST "https://api.z.ai/api/coding/paas/v4/chat/completions" \
  -H "Authorization: Bearer $ZAI_KEY" -H "Content-Type: application/json" \
  -d '{"model":"glm-4.7","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'

# MiniMax Coding Plan
MM_KEY=$(jq -r '.["minimax-coding-plan"].key' ~/.local/share/zee/auth.json)
curl -s -X POST "https://api.minimax.io/anthropic/v1/messages" \
  -H "x-api-key: $MM_KEY" -H "anthropic-version: 2023-06-01" -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M2.1","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'

# MiniMax TTS
MM_TTS_KEY=$(jq -r '.minimax.key' ~/.local/share/zee/auth.json)
curl -s -X POST "https://api.minimax.io/v1/t2a_v2" \
  -H "Authorization: Bearer $MM_TTS_KEY" -H "Content-Type: application/json" \
  -d '{"text":"hello","model":"speech-02-hd","voice_setting":{"voice_id":"Calm_Woman"}}'

# xAI
XAI_KEY=$(jq -r '.xai.key' ~/.local/share/zee/auth.json)
curl -s -X POST "https://api.x.ai/v1/chat/completions" \
  -H "Authorization: Bearer $XAI_KEY" -H "Content-Type: application/json" \
  -d '{"model":"grok-3-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'

# Google Gemini (API key)
GOOGLE_KEY=$(jq -r '.google.key' ~/.local/share/zee/auth.json)
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$GOOGLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"hi"}]}]}'

# Nebius
NEBIUS_KEY=$(jq -r '.nebius.key' ~/.local/share/zee/auth.json)
curl -s -X POST "https://api.tokenfactory.nebius.com/v1/chat/completions" \
  -H "Authorization: Bearer $NEBIUS_KEY" -H "Content-Type: application/json" \
  -d '{"model":"meta-llama/Llama-3.3-70B-Instruct","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'
```

### Full Health Check Script

```bash
cd packages/zee
bun run script/provider-health-check.ts

# Test specific provider
bun run script/provider-health-check.ts --provider kimi-for-coding

# Test all models
bun run script/provider-health-check.ts --all

# JSON output
bun run script/provider-health-check.ts --json
```


## Provider Monitoring

See [.agents/skills/provider-monitoring/SKILL.md](../.agents/skills/provider-monitoring/SKILL.md) for comprehensive monitoring capabilities.

### Quick Monitoring Commands

```bash
# Test all providers with colored output
cd packages/zee
bun run script/provider-health-check.ts

# Only show errors
bun run script/provider-health-check.ts --errors-only

# JSON output for automation
bun run script/provider-health-check.ts --json

# Test specific provider
bun run script/provider-health-check.ts --provider minimax-coding-plan
```

### Error Categories

The health check categorizes errors automatically:

| Category | HTTP | Description | Action |
|----------|------|-------------|--------|
| `AuthError` | 401 | Invalid API key, expired token | `zee auth login <provider>` |
| `PermissionError` | 403 | Insufficient scopes | Re-authenticate with broader scopes |
| `RateLimitError` | 429 | Too many requests | Wait and retry |
| `QuotaError` | - | Insufficient balance | Check billing dashboard |
| `ModelNotFoundError` | 404 | Model deprecated | Check models.dev |
| `ValidationError` | 400 | Invalid parameters | Update config |
| `ServerError` | 5xx | Provider issues | Retry later |
| `TimeoutError` | - | Connection timeout | Check network |
| `NetworkError` | - | DNS, connection refused | Check internet |

### Codex CLI Integration

Check OpenAI codex CLI status:

```bash
# View codex features
codex features

# Check codex auth
jq '.OPENAI_API_KEY' ~/.codex/auth.json

# Test codex
codex exec -m gpt-5.2-codex "Say pong"
```

## References

- [models.dev](https://models.dev) - Provider definitions
- [AgentDB Skills](../.agents/skills/) - Additional provider integrations
- [Provider Monitoring Skill](../.agents/skills/provider-monitoring/SKILL.md) - Full monitoring guide
