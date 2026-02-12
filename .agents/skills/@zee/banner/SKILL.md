---
name: banner
description: Zee-owned rotating banner in the TUI (reminders, todos, messages).
version: 1.0.0
author: zee
tags: [tui, zee, banner, reminders, todos]
---

# Banner

The `Banner` skill powers an always-on rotating banner shown in the zee TUI prompt UI.

- Display surface: zee TUI (top box above the prompt input)
- Ownership: Zee (shown even when using other personas)
- Behavior: rotates items; not dismissible

## Tools

### Refresh banner items

Auto-refresh is wired into the zee daemon cron (every 15 minutes). The cron job name is `zee-banner-refresh`.

Manual refresh (writes to KV so the running TUI updates live):
```bash
zee debug agent zee --tool zee-banner-refresh --params '{"autoSave": true}'
```

### Push a message into the banner

```bash
zee debug agent zee --tool zee-banner-push --params '{"message": "Heads up: standup in 10 minutes", "priority": "high"}'
```

Messages are not dismissible in the UI. They expire automatically after `ttlMinutes` (default: 24h).
