# Provider Blacklist Candidates

Analysis of providers that could be candidates for blacklisting.

---

## Current Status

### Already Hardcoded Blocked
| Provider | Reason |
|----------|--------|
| nebius | Permanently disabled |
| venice | Removed per request |
| alibaba | Removed per request |

---

## Candidates for Blacklisting

### 1. Synthetic (`synthetic`) - RECOMMENDED
**Why block:**
- HuggingFace-based proxy with inconsistent availability
- Models are prefixed with `hf:` which can be confusing
- Often redundant with direct provider access
- Quality/reliability varies

**Models affected:**
- hf:MiniMaxAI/MiniMax-M2.1
- hf:moonshotai/Kimi-K2-Thinking
- hf:zai-org/GLM-4.7
- hf:deepseek-ai/DeepSeek-R1-0528
- etc.

**Verdict:** BLOCK - Duplicate/redundant functionality

---

### 2. Opencode Zen (`opencode`) - CONSIDER
**Why block:**
- Internal/proxy service with unclear reliability
- Placeholder base URL (`https://example.invalid/zen/v1`)
- May be development/testing only

**Verdict:** CONSIDER BLOCK - Potentially unstable

---

### 3. Qwen Portal (`qwen-portal`) - CONSIDER
**Why block:**
- OAuth-only authentication complexity
- Limited model selection (coder-model, vision-model)
- Overlaps with direct Moonshot/Kimi access
- Requires separate OAuth flow

**Verdict:** OPTIONAL - Convenience vs complexity trade-off

---

### 4. Amazon Bedrock (`amazon-bedrock`) - OPTIONAL
**Why block:**
- Requires AWS credentials (complex setup)
- Enterprise-focused, not individual user friendly
- Dynamic discovery can be unpredictable
- Regional restrictions

**Verdict:** KEEP - Useful for AWS users

---

### 5. GitHub Copilot (`github-copilot`) - KEEP
**Why keep:**
- Popular for developers
- Already have subscription integration
- Good model selection (GPT-4o, o1, etc.)

**Verdict:** KEEP - Widely used

---

### 6. Moonshot (`moonshot`) - MERGE
**Why consider:**
- Duplicate of `kimi-for-coding` (same company)
- Only one model: kimi-k2.5
- Can consolidate under kimi-for-coding

**Verdict:** MERGE - Consolidate with kimi-for-coding

---

### 7. Z.AI Coding Plan (`zai-coding-plan`) - KEEP
**Why keep:**
- Unique GLM models
- Good for Chinese language tasks
- Active development

**Verdict:** KEEP - Unique capabilities

---

### 8. MiniMax (`minimax`) - KEEP
**Why keep:**
- Unique M2.1 model
- Good multimodal capabilities
- TTS integration

**Verdict:** KEEP - Unique provider

---

### 9. DeepSeek (`deepseek`) - KEEP
**Why keep:**
- Cost-effective reasoning
- Popular for coding
- Good alternative to OpenAI

**Verdict:** KEEP - Popular alternative

---

### 10. xAI (`xai`) - KEEP
**Why keep:**
- Long context (2M tokens)
- Grok models are unique
- X Premium integration

**Verdict:** KEEP - Unique capabilities

---

### 11. OpenRouter (`openrouter`) - KEEP
**Why keep:**
- Aggregates 100+ models
- Good fallback option
- OpenAI-compatible API

**Verdict:** KEEP - Useful aggregator

---

### 12. Ollama (`ollama`) - KEEP
**Why keep:**
- Local/offline capability
- Privacy-focused
- Free to use

**Verdict:** KEEP - Essential for local inference

---

## Summary Table

| Provider | Recommendation | Priority |
|----------|---------------|----------|
| synthetic | **BLOCK** | High |
| opencode | **CONSIDER BLOCK** | Medium |
| qwen-portal | **OPTIONAL** | Low |
| moonshot | **MERGE** | Low |
| amazon-bedrock | KEEP | - |
| github-copilot | KEEP | - |
| zai-coding-plan | KEEP | - |
| minimax | KEEP | - |
| deepseek | KEEP | - |
| xai | KEEP | - |
| openrouter | KEEP | - |
| ollama | KEEP | - |

---

## Recommended Block List Addition

```typescript
const PROVIDER_BLACKLIST = new Set<string>([
  "nebius",
  "venice",
  "alibaba",
  "synthetic",      // HuggingFace proxy, redundant
  // "opencode",     // Uncomment if unstable
  // "qwen-portal",  // Uncomment to disable OAuth complexity
])
```

---

## Alternative: Model-Level Blocking

Instead of blocking entire providers, consider blocking specific low-quality models:

```json
{
  "provider": {
    "synthetic": {
      "whitelist": []  // Block all synthetic models
    },
    "opencode": {
      "whitelist": []  // Block all opencode models
    }
  }
}
```

This is more granular than provider-level blocking.
