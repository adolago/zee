# Extended Provider Blacklist Analysis

Complete analysis of all providers including utility providers and Google variants.

---

## Currently Blocked (11 Providers)

```typescript
const PROVIDER_BLACKLIST = new Set<string>([
  "nebius",           // Permanently disabled
  "venice",           // Privacy proxy removed
  "alibaba",          // Removed per request
  "synthetic",        // Redundant HuggingFace proxy
  "ollama",           // Local provider - use vLLM instead
  "github-copilot",   // Subscription-based, limited models
  "amazon-bedrock",   // Enterprise AWS only
  "qwen-portal",      // OAuth complexity, limited models
  "moonshot",         // Duplicate of kimi-for-coding
  "google-vertex",    // Requires GCP service account
  "google-vertex-anthropic", // Requires GCP service account
])
```

---

## Active LLM Providers (11)

| Provider | Type | Block Recommendation |
|----------|------|---------------------|
| **anthropic** | Core LLM | KEEP |
| **openai** | Core LLM | KEEP |
| **google** | Core LLM (AI Studio API) | KEEP |
| **google-antigravity** | OAuth (Cloud Code) | KEEP |
| **xai** | Long Context | KEEP |
| **deepseek** | Budget | KEEP |
| **minimax** | Niche | KEEP |
| **zai-coding-plan** | GLM | KEEP (PAID) |
| **kimi-for-coding** | Coding | KEEP |
| **opencode** | Multi-model Proxy | KEEP |
| **openrouter** | Aggregator | KEEP |

---

## Utility Providers (Separately Blockable)

### Embedding Providers

| Provider ID | Service | Auth | Models |
|-------------|---------|------|--------|
| `google` | Embedding | `zee auth login google` | gemini-embedding-001 |

**Note:** Zee supports Google-only embeddings and reads the API key from the auth store.

---

### Reranking Providers

| Provider ID | Service | Env Var | Default Model |
|-------------|---------|---------|---------------|
| `voyage` | Reranking | `VOYAGE_API_KEY` | rerank-2 |
| `vllm` | Reranking | `VLLM_RERANKER_URL` | BAAI/bge-reranker-v2-m3 |

---

### TTS Providers

| Provider ID | Service | Env Var | Models |
|-------------|---------|---------|--------|
| `openai` | TTS | `OPENAI_API_KEY` | gpt-4o-mini-tts, tts-1, tts-1-hd |
| `elevenlabs` | TTS | `ELEVENLABS_API_KEY` | eleven_multilingual_v2 |
| `minimax` | TTS | `MINIMAX_API_KEY` | speech-2.8-hd |
| `edge` | TTS | None | Microsoft Edge voices |

---

### STT Providers

| Provider ID | Service | Env Var | Default Model |
|-------------|---------|---------|---------------|
| `google` | STT (Gemini) | `GOOGLE_API_KEY` | gemini-3-flash-preview |
| `openai` | STT | `OPENAI_API_KEY` | gpt-4o-mini-transcribe |
| `deepgram` | STT | `DEEPGRAM_API_KEY` | nova-3 |
| `groq` | STT | `GROQ_API_KEY` | whisper-large-v3-turbo |

---

## Google Provider Variants (2 Separate Providers)

Google has **2 distinct provider IDs** that can be blocked separately:

### 1. `google` - Google AI Studio API
- **Service:** Main LLM, Embedding, Gemini STT
- **Env Var:** `GOOGLE_API_KEY` or `GEMINI_API_KEY` (optional; embeddings use auth store)
- **Models:** gemini-3-pro/flash-preview, gemini-embedding-001
- **Auth:** API Key

### 2. `google-antigravity` - Google Cloud Code (Antigravity)
- **Service:** LLM via Cloud Code Assist
- **Default Model:** google-antigravity/claude-opus-4-5-thinking
- **Auth:** OAuth (PKCE + localhost callback)
- **Scopes:** cloud-platform, cclog, experimentsandconfigs

### To Block Google Variants Individually:

```typescript
// Block only Antigravity
"google-antigravity"

// Block main Google AI Studio (keeps CLI/Antigravity)
"google"
```

---

## Provider Granularity Summary

| Category | Count | Can Block Individually |
|----------|-------|------------------------|
| LLM Providers | 11 | Yes |
| Google Variants | 2 | Yes (google, google-antigravity) |
| Embedding | 1 | Yes (google) |
| Reranking | 2 | Yes (voyage, vllm) |
| TTS | 4 | Yes (openai, elevenlabs, minimax, edge) |
| STT | 4 | Yes (google, openai, deepgram, groq) |

**Total Blockable Provider IDs:** ~27

---

## Recommended Minimal Setup

If you want to block by service type:

```typescript
// Block all TTS
const blockTTS = ["elevenlabs", "minimax", "edge"];

// Block all STT except Google
const blockSTT = ["deepgram", "groq"];

// Block all reranking (if not using)
const blockRerank = ["voyage"];

// Block Google variants (keep main google)
const blockGoogleVariants = ["google-antigravity"];
```

---

## Complete Provider Registry

### LLM (11)
anthropic, openai, google, google-antigravity, xai, deepseek, minimax, zai-coding-plan, kimi-for-coding, opencode, openrouter

### Embedding (1)
google

### Reranking (2)
voyage, vllm

### TTS (4)
openai, elevenlabs, minimax, edge

### STT (4)
google, openai, deepgram, groq

### Image (1)
openai

### Web Search (2)
brave, perplexity

**Total: ~29 distinct provider IDs**
