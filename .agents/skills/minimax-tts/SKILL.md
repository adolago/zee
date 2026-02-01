---
name: minimax-tts
description: MiniMax TTS for voice synthesis in TUI and messaging. High-quality text-to-speech with multiple voices and languages.
version: 1.0.0
author: Artur
tags: [speech, tts, voice, synthesis]
homepage: https://www.minimax.io/
metadata: {"zee":{"emoji":"🔊","requires":{"env":["MINIMAX_API_KEY"]}}}
---

# MiniMax TTS - Unified Voice Output

**Text-to-speech for TUI and messaging platforms.**

> **Note:** STT (speech-to-text) is handled by `google-chirp-2` via Vertex AI.
> This skill covers TTS only.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VOICE PIPELINE                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  STT (Speech-to-Text)         TTS (Text-to-Speech)          │
│  ════════════════════         ════════════════════          │
│  Google Chirp 2               MiniMax TTS                   │
│  (via Vertex AI)              (this skill)                  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    MiniMax TTS Output                       │
│                           │                                 │
│           ┌───────────────┼───────────────┐                 │
│           │               │               │                 │
│           ▼               ▼               ▼                 │
│       TUI Audio     WhatsApp Voice  Telegram Voice          │
│       (speaker)     (voice note)    (voice note)            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Authentication

Uses existing **MiniMax API key** configured via:
- Environment variable: `MINIMAX_API_KEY`
- Connect provider: `minimax-tts`
- Config: `minimax-tts.apiKey`

```bash
# Check if MiniMax TTS is configured
echo $MINIMAX_API_KEY

# Or via Zee
zee configure  # Select Model/auth → MiniMax
```

## API Endpoint

```
POST https://api.minimax.io/v1/t2a_v2
Authorization: Bearer $MINIMAX_API_KEY
```

## Usage

### TUI Voice Output

When agent responds, TTS converts text to audio played through speakers:

```typescript
// TUI plays audio response
const audio = await minimaxTts({
  text: "Here's your calendar for today",
  voice: 'English_Graceful_Lady',
  format: 'mp3',
});
playAudio(audio);
```

### Messaging Voice Notes

Agent responses can be sent as voice notes on WhatsApp/Telegram:

```typescript
// Send as voice note
const audio = await minimaxTts({
  text: response,
  voice: 'English_Graceful_Lady',
  format: 'opus',  // Optimal for Telegram
});
sendVoiceNote(chatId, audio);
```

## API Request Format

```typescript
const response = await fetch('https://api.minimax.io/v1/t2a_v2', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: 'speech-2.8-hd',
    text: 'Hello, how can I help you today?',
    stream: false,
    voice_setting: {
      voice_id: 'English_Graceful_Lady',
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',  // or 'opus' for voice notes
      channel: 1,
    },
  }),
});
```

## Available Voices

| Voice ID | Description | Best For |
|----------|-------------|----------|
| `English_Graceful_Lady` | Elegant female | General assistant |
| `English_Calm_Man` | Calm male | Professional |
| `English_Energetic_Girl` | Energetic female | Casual |
| `English_Deep_Man` | Deep male | Authoritative |

## Audio Formats

| Format | Use Case | Quality |
|--------|----------|---------|
| `mp3` | TUI playback, general | Good |
| `opus` | Telegram voice notes | Excellent compression |
| `wav` | High quality, large | Lossless |

## Configuration

### In `zee.json`

```json
{
  "messages": {
    "tts": {
      "provider": "minimax",
      "auto": "always",
      "minimax": {
        "voice": "English_Graceful_Lady",
        "model": "speech-2.8-hd"
      }
    }
  }
}
```

### Auto-TTS Modes

| Mode | Behavior |
|------|----------|
| `off` | No automatic TTS |
| `always` | All responses get voice |
| `inbound` | Voice reply to voice messages |
| `tagged` | Only when agent uses `[[tts]]` tags |

## Session Unification

Voice output follows the same session as text:

```
User (TUI):      "What's the weather?"
Agent (Voice):   "It's 72°F and sunny in San Francisco"
User (WhatsApp): [Voice: "Add reminder for umbrella"]
Agent (Voice):   Sent as voice note to WhatsApp
```

## Integration Points

- **Auth Plugin**: `src/plugin/builtin/minimax-tts-auth.ts`
- **TTS Core**: `packages/personas/zee/src/tts/tts.ts`
- **Gateway TTS**: `packages/personas/zee/src/gateway/server-methods/tts.ts`
- **Agent Tool**: `packages/personas/zee/src/agents/tools/tts-tool.ts`

## Error Handling

```typescript
// Common errors
if (response.base_resp?.status_code === 1004) {
  // Invalid API key
}
if (response.status === 429) {
  // Rate limited - implement backoff
}
```

## Related

- **STT**: `google-chirp-2` skill (speech-to-text via Vertex AI)
- **MiniMax Models**: `minimax/MiniMax-M2.1` for chat/completion

## Guardrails

- **Never** log full API responses (may contain audio data)
- **Never** store audio files longer than needed
- **Always** use secure credential management
- **Always** respect rate limits (implement backoff)
