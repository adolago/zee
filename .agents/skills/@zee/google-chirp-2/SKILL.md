---
name: google-chirp-2
description: Single STT source for the entire system. Google Chirp 2 handles all speech-to-text across TUI dictation and messaging platforms (WhatsApp, Telegram voice messages).
version: 1.0.0
author: Artur
tags: [speech, stt, voice, google]
homepage: https://cloud.google.com/vertex-ai/docs/generative-ai/speech/chirp-2
metadata: {"zee":{"emoji":"🎙️","requires":{"providers":["google-vertex"]}}}
---

# Google Chirp 2 - Unified STT

**The single source of speech-to-text for the entire system.**

> **Note:** TTS (text-to-speech) is handled separately by `minimax-tts` provider.
> This skill covers STT only.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VOICE PIPELINE                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  STT (Speech-to-Text)         TTS (Text-to-Speech)          │
│  ════════════════════         ════════════════════          │
│  Google Chirp 2               MiniMax TTS                   │
│  (via Vertex AI)              (separate provider)           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   TUI Dictation ──────┐                                     │
│                       │                                     │
│   WhatsApp Voice ─────┼──→ Chirp 2 (Vertex AI) ──→ Text    │
│                       │                                     │
│   Telegram Voice ─────┘                                     │
│                                                             │
│   ══════════════════════════════════════════════════════    │
│   Unified Sessions: TUI + Messages = Same Session           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Authentication

Uses existing **Google Vertex AI** credentials configured via connect provider.
No additional setup required if Vertex AI is already connected.

```bash
# Verify Vertex AI is connected
zee config get providers.google-vertex

# Or check via connect provider status
zee channels status
```

## Why Single STT Source?

1. **Consistency** - Same transcription quality everywhere
2. **Unified Sessions** - TUI and messaging share the same session context
3. **Simplified Architecture** - One integration to maintain
4. **Existing Auth** - Leverages already-configured Vertex AI credentials

## Input Sources

| Source | Format | Flow |
|--------|--------|------|
| TUI Dictation | Live microphone stream | Real-time streaming |
| WhatsApp Voice | .ogg/.opus files | Async batch |
| Telegram Voice | .ogg/.oga files | Async batch |

## Vertex AI Integration

### Streaming (TUI Dictation)

```typescript
import { VertexAI } from '@google-cloud/vertexai';

// Uses credentials from connect provider
const vertexai = new VertexAI({
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: 'us-central1',
});

const speechConfig = {
  model: 'chirp_2',
  languageCode: 'en-US',
  interimResults: true,  // Live feedback while speaking
};
```

### Async (Voice Messages)

```typescript
async function transcribeVoiceMessage(audioBuffer: Buffer) {
  // Vertex AI handles auth via connect provider
  const response = await vertexai.speech.recognize({
    model: 'chirp_2',
    audio: { content: audioBuffer.toString('base64') },
    config: {
      languageCode: 'auto',  // Auto-detect language
    },
  });

  return response.results
    ?.map(r => r.alternatives?.[0]?.transcript)
    .join(' ');
}
```

## Supported Languages

Chirp 2 supports 100+ languages with automatic detection:

- `auto` - Automatic language detection (recommended)
- `en-US`, `en-GB` - English variants
- `pt-BR`, `pt-PT` - Portuguese variants
- `es-ES`, `es-MX` - Spanish variants
- And 100+ more...

## Session Unification

Voice from any surface joins the same session:

```
User (TUI):      "Check my calendar"
Agent:           "You have 3 meetings today..."
User (WhatsApp): [Voice: "Add lunch with Sarah at noon"]
                 → Chirp 2 → Same session
Agent:           "Added lunch with Sarah at 12:00 PM"
User (TUI):      "What did I just add?"
Agent:           "You added lunch with Sarah at noon"
```

## Integration Points

- **TUI Dictation**: `packages/agent-core/src/tui/dictation.ts`
- **Voice Messages**: `packages/personas/zee/src/media-understanding/`
- **Unified Sessions**: `src/swarm/sessions/`
- **Vertex AI Provider**: Configured via connect provider

## Related

- **TTS**: `minimax-tts` provider (separate from STT)
- **Provider Config**: `zee configure` → Google Vertex AI

## Guardrails

- **Never** store raw audio after transcription
- **Never** log transcription content in production
- **Always** use Vertex AI credentials (no hardcoded keys)
- **Always** respect user privacy settings
