---
summary: "CLI reference for `zee agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
---

# `zee agents`

Manage isolated agents (workspaces + auth + routing).

Related:
- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
zee agents list
zee agents add work --workspace ~/zee-work
zee agents set-identity --workspace ~/zee --from-identity
zee agents set-identity --agent main --avatar avatars/zee.png
zee agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:
- Example path: `~/zee/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:
- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
zee agents set-identity --workspace ~/zee --from-identity
```

Override fields explicitly:

```bash
zee agents set-identity --agent main --name "Zee" --emoji "🦞" --avatar avatars/zee.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "Zee",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/zee.png"
        }
      }
    ]
  }
}
```
