# Provider Rosetta Stone

Zee keeps a deliberately small provider surface. Core LLM routing is limited to American and Chinese frontier providers, plus OpenRouter as the explicit routing exception.

## LLM Providers

| Provider ID | SDK | Auth | Primary use |
| --- | --- | --- | --- |
| `openai` | `@ai-sdk/openai` | OAuth or API key | GPT, reasoning, and Codex models |
| `anthropic` | `@ai-sdk/anthropic` | OAuth or API key | Claude models |
| `google` | `@ai-sdk/google` | API key | Gemini models |
| `google-antigravity` | `@ai-sdk/google` | Antigravity OAuth | Gemini models through Antigravity auth |
| `xai` | `@ai-sdk/xai` | API key | Grok models |
| `deepseek` | `@ai-sdk/openai-compatible` | API key | DeepSeek models |
| `kimi-for-coding` | `@ai-sdk/openai-compatible` | OAuth | Kimi coding models |
| `zai-coding-plan` | `@ai-sdk/openai-compatible` | API key | GLM coding models |
| `minimax-coding-plan` | `@ai-sdk/anthropic` | API key | MiniMax coding-plan chat models |
| `openrouter` | `@openrouter/ai-sdk-provider` | API key | Model routing through OpenRouter |

## Service Providers

| Provider ID | Service | Auth | Notes |
| --- | --- | --- | --- |
| `wisprflow` | Speech-to-text | API key | The only STT provider |
| `languagetool` | Writing tools | None or API key | Grammar and language checks |
| `minimax` | Text-to-speech | API key | Voice output |
| `minimax-tts` | Text-to-speech | API key | Voice output alias |
| `openai` | Image generation | OAuth or API key | Image generation |
| `alpha-vantage` | Market data | API key | OpenBB-compatible market data |
| `fmp` | Market data | API key | OpenBB-compatible market data |
| `sec` | Market data | None | SEC filings and company data |

## Authentication

All external auth is opt-in. Setup can run unattended when at least one LLM provider credential is available through the environment, existing auth store, or non-interactive setup input.

```bash
zee auth list
zee auth login <provider-id>
zee auth logout <provider-id>
```

Common environment variables:

| Provider | Environment variables |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `google` | `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `kimi-for-coding` | `KIMI_API_KEY` |
| `zai-coding-plan` | `ZHIPU_API_KEY` |
| `minimax`, `minimax-coding-plan`, `minimax-tts` | `MINIMAX_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `wisprflow` | `WISPRFLOW_API_KEY` |
| `languagetool` | `LANGUAGETOOL_API_KEY` |
| `alpha-vantage` | `ALPHA_VANTAGE_API_KEY` |
| `fmp` | `FMP_API_KEY` |

## Google And Antigravity

`google` is a normal LLM provider for Gemini API-key auth.

`google-antigravity` is the preferred path when Gemini models should use Antigravity OAuth. It is configured separately so an API-key Gemini setup and an Antigravity setup can coexist.

```bash
zee auth login google
zee auth login google-antigravity
```

## MiniMax

MiniMax has separate chat and speech roles:

| Provider ID | Role |
| --- | --- |
| `minimax-coding-plan` | Chat through the coding-plan account |
| `minimax` | Text-to-speech through the pay-as-you-go account |
| `minimax-tts` | Text-to-speech alias |

TTS example:

```json
{
  "messages": {
    "tts": {
      "provider": "minimax",
      "auto": "always",
      "minimax": {
        "voice": "Calm_Woman"
      }
    }
  }
}
```

## Model ID Patterns

| Provider | Model ID pattern | Example |
| --- | --- | --- |
| `openai` | `gpt-*`, `o*`, `codex-*` | `gpt-5.4` |
| `anthropic` | `claude-*` | `claude-sonnet-4-5` |
| `google` | `gemini-*` | `gemini-3-pro` |
| `xai` | `grok-*` | `grok-4` |
| `deepseek` | `deepseek-*` | `deepseek-reasoner` |
| `kimi-for-coding` | `kimi-*`, `k2*` | `kimi-k2.5-thinking` |
| `zai-coding-plan` | `glm-*` | `glm-4.7` |
| `minimax-coding-plan` | `MiniMax-*` | `MiniMax-M2.1` |
| `openrouter` | `<provider>/<model>` | `openai/gpt-5-chat` |

## Troubleshooting

```bash
zee auth list
zee auth login <provider-id>
zee doctor
```

Use `zee auth logout <provider-id>` followed by `zee auth login <provider-id>` when a stored OAuth token is expired or an API key has been rotated.
