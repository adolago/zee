---
summary: "WhatsApp allowlist hardening: prefix + whitespace normalization"
read_when:
  - Reviewing historical WhatsApp allowlist changes
---
# WhatsApp Allowlist Hardening

**Date**: 2026-01-05  
**Status**: Complete  
**PR**: #216

## Summary

WhatsApp allowlists accept an optional `whatsapp:` prefix case-insensitively, and tolerate accidental
whitespace. This aligns inbound allowlist checks with outbound send normalization.

## What changed

- `whatsapp:` prefixes are treated as optional (case-insensitive).
- Allowlist entries are trimmed; empty entries are ignored.

## Examples

All of these are accepted for the same ID:

- `whatsapp:@alice:example.org`
- `WHATSAPP:+15551234567`
- `  @alice:example.org  `

## Why it matters

Copy/paste from logs or chat IDs often includes prefixes and whitespace. Normalizing avoids
false negatives when deciding whether to respond in DMs or groups.

## Related docs

- [Group Chats](/concepts/groups)
- [WhatsApp Channel](/channels/whatsapp)
