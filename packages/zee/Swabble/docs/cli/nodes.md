---
summary: "CLI reference for `zee nodes` (list/status/approve/invoke)"
read_when:
  - You’re managing paired node hosts
  - You need to approve requests or invoke node commands
---

# `zee nodes`

Manage paired node hosts and invoke node capabilities.

Related:
- Nodes overview: [Nodes](/nodes)

Common options:
- `--url`, `--token`, `--timeout`, `--json`

## Common commands

```bash
zee nodes list
zee nodes list --connected
zee nodes list --last-connected 24h
zee nodes pending
zee nodes approve <requestId>
zee nodes status
zee nodes status --connected
zee nodes status --last-connected 24h
```

`nodes list` prints pending/paired tables. Paired rows include the most recent connect age (Last Connect).
Use `--connected` to only show currently-connected nodes. Use `--last-connected <duration>` to
filter to nodes that connected within a duration (e.g. `24h`, `7d`).

## Invoke / run

```bash
zee nodes invoke --node <id|name|ip> --command <command> --params <json>
zee nodes run --node <id|name|ip> <command...>
zee nodes run --raw "git status"
zee nodes run --agent main --node <id|name|ip> --raw "git status"
```

Invoke flags:
- `--params <json>`: JSON object string (default `{}`).
- `--invoke-timeout <ms>`: node invoke timeout (default `15000`).
- `--idempotency-key <key>`: optional idempotency key.

### Exec-style defaults

`nodes run` mirrors the model’s exec behavior (defaults + approvals):

- Reads `tools.exec.*` (plus `agents.list[].tools.exec.*` overrides).
- Uses exec approvals (`exec.approval.request`) before invoking `system.run`.
- `--node` can be omitted when `tools.exec.node` is set.
- Requires a node that advertises `system.run` (headless node host).

Flags:
- `--cwd <path>`: working directory.
- `--env <key=val>`: env override (repeatable).
- `--command-timeout <ms>`: command timeout.
- `--invoke-timeout <ms>`: node invoke timeout (default `30000`).
- `--needs-screen-recording`: require screen recording permission.
- `--raw <command>`: run a shell string (`/bin/sh -lc` or `cmd.exe /c`).
- `--agent <id>`: agent-scoped approvals/allowlists (defaults to configured agent).
- `--ask <off|on-miss|always>`, `--security <deny|allowlist|full>`: overrides.
