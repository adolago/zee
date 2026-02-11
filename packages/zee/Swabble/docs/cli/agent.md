---
summary: "CLI reference for `zee agent` (send one agent turn via the Gateway)"
read_when:
  - You want to run one agent turn from scripts (optionally deliver reply)
---

# `zee agent`

Run an agent turn via the Gateway (use `--local` for embedded).
Use `--agent <id>` to target a configured agent directly.

Related:
- Agent send tool: [Agent send](/tools/agent-send)

## Examples

```bash
zee agent --to +15555550123 --message "status update" --deliver
zee agent --agent ops --message "Summarize logs"
zee agent --session-id 1234 --message "Summarize inbox" --thinking medium
```
