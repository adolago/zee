---
summary: "Inbound channel location parsing (WhatsApp) and context fields"
read_when:
  - Adding or modifying channel location parsing
  - Using location context fields in agent prompts or tools
---

# Channel location parsing

Zee normalizes shared locations from chat channels into:
- human-readable text appended to the inbound body, and
- structured fields in the auto-reply context payload.

Currently supported:
- **WhatsApp** (locationMessage + liveLocationMessage)

## Text formatting
Locations are rendered as friendly lines without brackets:

- Pin:
  - `📍 48.858844, 2.294351 ±12m`
- Named place:
  - `📍 Eiffel Tower — Champ de Mars, Paris (48.858844, 2.294351 ±12m)`
- Live share:
  - `🛰 Live location: 48.858844, 2.294351 ±12m`

If the channel includes a caption/comment, it is appended on the next line:
```
📍 48.858844, 2.294351 ±12m
Meet here
```

## Context fields
When a location is present, these fields are added to `ctx`:
- `LocationLat` (number)
- `LocationLon` (number)
- `LocationAccuracy` (number, meters; optional)
- `LocationName` (string; optional)
- `LocationAddress` (string; optional)
- `LocationSource` (`pin | place | live`)
- `LocationIsLive` (boolean)

## Channel notes
- **WhatsApp**: `locationMessage.comment` and `liveLocationMessage.caption` are appended as the caption line.
