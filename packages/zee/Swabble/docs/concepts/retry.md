---
summary: "Retry policy for outbound provider calls"
read_when:
  - Updating provider retry behavior or defaults
  - Debugging provider send errors or rate limits
---
# Retry policy

## Goals
- Retry per HTTP request, not per multi-step flow.
- Preserve ordering by retrying only the current step.
- Avoid duplicating non-idempotent operations.

## Defaults
- Attempts: 3
- Max delay cap: 30000 ms
- Min delay: 300 ms
- Jitter: 0

## Behavior
- Connector-dependent. Some outbound calls only retry on rate limits (HTTP 429) and transient
  network errors.

## Configuration
When supported by a connector, set retry policy under `channels.<id>.retry` in `~/.zee/zee.json`:

```json5
{
  channels: {
    whatsapp: {
      retry: {
        attempts: 3,
        minDelayMs: 300,
        maxDelayMs: 30000,
        jitter: 0
      }
    }
  }
}
```

## Notes
- Retries apply per request (message send, media upload, reaction, poll, sticker).
- Composite flows do not retry completed steps.
