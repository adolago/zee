# Providers Deep Dive

Detailed analysis of providers with hidden/deprecated models.

---

## Table of Contents

1. [OpenAI](#openai)
2. [Google](#google-optional-disabled-by-default)
3. [xAI (Grok)](#xai-grok)
4. [Anthropic](#anthropic)
5. [Kimi (Moonshot)](#kimi-moonshot)
6. [Z.AI (GLM)](#zai-glm)
7. [Alibaba (Qwen)](#alibaba-qwen)
8. [MiniMax](#minimax)
9. [DeepSeek](#deepseek)

---

## OpenAI

### Active Models (Recommended)

| Model | Tier | Capabilities | Context | Use Case |
|-------|------|--------------|---------|----------|
| `gpt-5.2` | Flagship | vision, reasoning, tools | 400K | General purpose |
| `gpt-5-pro` | Premium | vision, reasoning, tools | 400K | High-quality output |
| `gpt-5-mini` | Fast | vision, reasoning, tools | 400K | Speed/cost optimized |
| `gpt-5.1-codex` | Code | vision, reasoning, tools | 400K | Coding tasks |
| `o3` | Reasoning | reasoning, tools | 200K | Complex reasoning |
| `o4-mini` | Fast Reasoning | vision, reasoning, tools | 200K | Quick reasoning |

### Blocked Models (Deprecated)

| Model | Blocked Reason | Replacement |
|-------|---------------|-------------|
| `gpt-4` | Legacy | gpt-5.2 |
| `gpt-4-turbo` | Legacy | gpt-5.2 |
| `gpt-4o` | Superseded | gpt-5.2 |
| `gpt-4o-mini` | Superseded | gpt-5-mini |

### Environment Variables

```bash
OPENAI_API_KEY=sk-...
# Optional: Custom base URL for proxies
OPENAI_BASE_URL=https://api.openai.com/v1
```

---

## Google

Google/Gemini is a normal LLM provider. STT remains Wispr Flow-only and memory embeddings remain local-only.

### Optional Models

| Model | Tier | Capabilities | Context | Use Case |
|-------|------|--------------|---------|----------|
| `gemini-3-pro-preview` | Flagship | vision, audio, video, PDF, tools | 1M | Complex multimodal |
| `gemini-3-flash-preview` | Fast | vision, audio, video, PDF, tools | 1M | Speed optimized |

### Blocked Models (Deprecated)

| Model | Blocked Reason | Replacement |
|-------|---------------|-------------|
| `gemini-2.5-flash` | Superseded by v3 | gemini-3-flash-preview |
| `gemini-2.5-pro` | Superseded by v3 | gemini-3-pro-preview |
| `gemini-2.5-flash-lite` | Superseded by v3 | gemini-3-flash-preview |
| `gemini-live-2.5-flash` | Superseded by v3 | gemini-3-flash-preview |

### Environment Variables

```bash
# Only for explicit Google-backed LLM/STT integrations.
GOOGLE_API_KEY=...
# Or alias:
GEMINI_API_KEY=...
```

### Auth Methods

1. **API Key** (explicit opt-in only): `GOOGLE_API_KEY`
2. **OAuth** (explicit opt-in only): `google-antigravity`

---

## xAI (Grok)

### Active Models (Recommended)

| Model | Tier | Capabilities | Context | Use Case |
|-------|------|--------------|---------|----------|
| `grok-4-fast` | Flagship | vision, reasoning, tools | 2M | General purpose |
| `grok-4-1-fast` | Premium | vision, reasoning, tools | 2M | Latest features |
| `grok-code-fast-1` | Code | reasoning, tools | 256K | Coding tasks |

### Blocked Models (Deprecated)

| Model | Blocked Reason | Replacement |
|-------|---------------|-------------|
| `grok-2*` series | Superseded by v4 | grok-4-fast |
| `grok-3*` series | Superseded by v4 | grok-4-fast |
| `grok-4` (base) | Use fast variant | grok-4-fast |
| `grok-4-fast-non-reasoning` | Limited | grok-4-fast |

### Environment Variables

```bash
XAI_API_KEY=xai-...
```

---

## Anthropic

### Active Models (Recommended)

| Model | Tier | Capabilities | Context | Use Case |
|-------|------|--------------|---------|----------|
| `claude-opus-4-5` | Flagship | vision, PDF, reasoning, tools | 200K | Complex tasks |
| `claude-sonnet-4-5` | Balanced | vision, PDF, reasoning, tools | 1M | General purpose |
| `claude-haiku-4-5` | Fast | vision, PDF, reasoning, tools | 200K | Speed/cost |

### Model Variants

All models have automatic version deduplication:
- Dated snapshots (e.g., `claude-sonnet-4-5-20241022`) are hidden
- Only `-latest` suffix or highest version is shown

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...
# Or OAuth:
ANTHROPIC_OAUTH_TOKEN=...
```

### OAuth Configuration

```typescript
{
  refreshUrl: "https://console.anthropic.com/v1/oauth/token",
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
}
```

---

## Kimi (Moonshot)

### Active Models (Recommended)

| Model | Tier | Capabilities | Context | Use Case |
|-------|------|--------------|---------|----------|
| `kimi-k2.5` | Balanced | vision, reasoning, tools, structured | 256K | General purpose |
| `kimi-k2.5-thinking` | Reasoning | vision, reasoning, tools, structured | 256K | Complex reasoning |

### Blocked Models (Deprecated)

| Model | Blocked Reason | Replacement |
|-------|---------------|-------------|
| `kimi-k2-thinking` | Superseded | kimi-k2.5-thinking |

### Providers

1. **kimi-for-coding**: `KIMI_API_KEY` → `https://api.kimi.com/coding/v1`
2. **moonshot**: `MOONSHOT_API_KEY` → `https://api.moonshot.ai/v1`
3. **kimi-code**: `KIMICODE_API_KEY` → `https://api.kimi.com/coding/v1`

---

## Z.AI (GLM)

### Active Models (Recommended)

| Model | Tier | Capabilities | Context | Use Case |
|-------|------|--------------|---------|----------|
| `glm-4.7` | Flagship | reasoning, tools | 204K | General purpose |

### Blocked Models (Deprecated)

| Model | Blocked Reason | Replacement |
|-------|---------------|-------------|
| `glm-4.5` | Superseded | glm-4.7 |
| `glm-4.5-air` | Superseded | glm-4.7 |
| `glm-4.5-flash` | Superseded | glm-4.7 |
| `glm-4.5v` | Superseded | glm-4.7 |
| `glm-4.6` | Superseded | glm-4.7 |
| `glm-4.6v` | Superseded | glm-4.7 |

### Environment Variables

```bash
ZHIPU_API_KEY=...
# Or:
Z_AI_API_KEY=...
ZAI_API_KEY=...
```

### Base URL

```
https://api.z.ai/api/coding/paas/v4
```

---

## Alibaba (Qwen)

### Active Models (Recommended)

| Model | Tier | Capabilities | Context | Use Case |
|-------|------|--------------|---------|----------|
| `qwen3-vl-235b-a22b` | Vision | vision, reasoning, tools | 131K | Vision tasks |
| `qwen3-coder-plus` | Code | tools | 1M | Coding |
| `qwen-plus` | Balanced | reasoning, tools | 1M | General |
| `qwen3-max` | Flagship | tools | 262K | Complex tasks |

### Notable Models

| Model | Specialization |
|-------|---------------|
| `qwen3-coder-flash` | Fast coding |
| `qwen3-vl-plus` | Enhanced vision |
| `qvq-max` | Visual reasoning |
| `qwq-plus` | Reasoning |

### Environment Variables

```bash
DASHSCOPE_API_KEY=...
```

### Base URL

```
https://dashscope-intl.aliyuncs.com/compatible-mode/v1
```

---

## MiniMax

### Active Models (Recommended)

| Model | Tier | Capabilities | Context | Use Case |
|-------|------|--------------|---------|----------|
| `MiniMax-M2.1` | Flagship | reasoning, tools | 204K | General purpose |

### Environment Variables

```bash
MINIMAX_API_KEY=...
# Or:
ZEE_MINIMAX_API_KEY=...
```

### Base URLs

- LLM: `https://api.minimax.io/anthropic/v1`
- TTS: `https://api.minimax.io/v1`

---

## DeepSeek

### Active Models (Recommended)

| Model | Tier | Capabilities | Context | Use Case |
|-------|------|--------------|---------|----------|
| `deepseek-chat` | Balanced | tools | 128K | General |
| `deepseek-reasoner` | Reasoning | reasoning, tools | 128K | Complex reasoning |

### Environment Variables

```bash
DEEPSEEK_API_KEY=...
```

### Base URL

```
https://api.deepseek.com
```

---

## Provider Comparison Matrix

| Provider | Auth | Free Tier | Best For | Avg Latency |
|----------|------|-----------|----------|-------------|
| OpenAI | API Key | No | General purpose | Low |
| Anthropic | API Key/OAuth | No | Complex reasoning | Medium |
| Google | API Key | Yes (generous) | Multimodal | Low |
| xAI | API Key | No (X Premium) | Long context | Low |
| DeepSeek | API Key | Yes | Cost-effective | Medium |
| MiniMax | API Key | No | Chinese/Asian | Low |

---

## Configuration Examples

### Disable Entire Provider

```json
{
  "disabled_providers": ["xai"]
}
```

### Custom Provider Priority

```json
{
  "fallback": {
    "rules": [
      {
        "condition": "rate_limit",
        "fallbacks": ["anthropic", "openai", "google"]
      }
    ]
  }
}
```
