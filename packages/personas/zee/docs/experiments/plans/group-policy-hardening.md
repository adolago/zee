---
summary: "Matrix allowlist hardening: prefix + whitespace normalization"
read_when:
  - Reviewing historical Matrix allowlist changes
---
# Matrix Allowlist Hardening

**Date**: 2026-01-05  
**Status**: Complete  
**PR**: #216

## Summary

Matrix allowlists accept an optional `matrix:` prefix case-insensitively, and tolerate accidental
whitespace. This aligns inbound allowlist checks with outbound send normalization.

## What changed

- `matrix:` prefixes are treated as optional (case-insensitive).
- Allowlist entries are trimmed; empty entries are ignored.

## Examples

All of these are accepted for the same ID:

- `matrix:@alice:example.org`
- `MATRIX:@alice:example.org`
- `  @alice:example.org  `

## Why it matters

Copy/paste from logs or chat IDs often includes prefixes and whitespace. Normalizing avoids
false negatives when deciding whether to respond in DMs or groups.

## Related docs

- [Group Chats](/concepts/groups)
- [Matrix Channel](/channels/matrix)
