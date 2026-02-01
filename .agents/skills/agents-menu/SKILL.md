---
name: agents-menu
description: Quick reference for personas, handles, and delegation.
version: 1.0.0
author: Artur
tags: [menu, personas, delegation, quick-reference]
---

# Personas Quick Reference

| Handle | Domain | When to Use |
|--------|--------|-------------|
| @zee | Personal | Memory, messaging, calendar, contacts |
| @stanley | Investing | Markets, portfolio, research |
| @johny | Learning | Knowledge, practice, study |

## Delegation Examples

```
Ask @zee to schedule a meeting.
Ask @stanley to analyze NVDA fundamentals.
Ask @johny to build a study plan for calculus.
```

## CLI

```bash
agent-core --agent zee "..."
agent-core --agent stanley "..."
agent-core --agent johny "..."
```

## Orchestration

See `tiara-orchestration` skill for:
- Drone spawning
- Shared memory (Qdrant)
- Conversation continuity
- WezTerm integration
- Hold/Release mode
