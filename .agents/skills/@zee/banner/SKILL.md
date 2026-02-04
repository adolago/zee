---
name: banner
description: Zee-owned rotating banner in the agent-core TUI (reminders, todos, messages).
version: 1.0.0
author: agent-core
tags: [tui, zee, banner, reminders, todos]
---

# Banner

The `Banner` skill powers an always-on rotating banner shown in the agent-core TUI prompt UI.

- Display surface: agent-core TUI (top box above the prompt input)
- Ownership: Zee (shown even when using other personas)
- Behavior: rotates items; not dismissible

## Tools

### Refresh banner items

Manual refresh (writes to KV so the running TUI updates live):
```bash
agent-core tool zee:banner-refresh '{"autoSave": true}'
```

One-time setup (auto-refresh every 15 minutes):
```bash
agent-core tool zee:banner-refresh '{"autoSave": true, "setupCron": true}'
```

### Push a message into the banner

```bash
agent-core tool zee:banner-push '{"message": "Heads up: standup in 10 minutes", "priority": "high"}'
```

Messages are not dismissible in the UI. They expire automatically after `ttlMinutes` (default: 24h).

