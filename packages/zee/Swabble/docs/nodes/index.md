---
summary: "Nodes: headless node hosts for remote system.run"
read_when:
  - You need to run system.run on another machine
  - You want to pair or manage node hosts
---

# Nodes

A **node host** is a headless runtime that connects to the Gateway WebSocket with
`role: "node"` and executes `system.run` / `system.which` on the node machine.

Zee ships only headless node hosts in this repo. UI, camera, and screen-capture
nodes are out of scope here.

## Pairing + status

Node hosts use device pairing. Approve via the devices CLI:

```bash
zee devices list
zee devices approve <requestId>
zee devices reject <requestId>
zee nodes status
zee nodes describe --node <idOrNameOrIp>
```

## Start a node host (foreground)

On the node machine:

```bash
zee node run --host <gateway-host> --port 18789 --display-name "Build Node"
```

## Start a node host (service)

```bash
zee node install --host <gateway-host> --port 18789 --display-name "Build Node"
zee node restart
```

## Allowlist commands

Exec approvals are **per node host**. Add allowlist entries from the gateway:

```bash
zee approvals allowlist add --node <id|name|ip> "/usr/bin/uname"
```

Approvals live on the node host at `~/.zee/exec-approvals.json`.

## Point exec at the node

Gateway config:

```bash
zee config set tools.exec.host node
zee config set tools.exec.security allowlist
zee config set tools.exec.node "<id-or-name>"
```

Or per session:

```
/exec host=node security=allowlist node=<id-or-name>
```

## Related

- [Node host CLI](/cli/node)
- [Exec tool](/tools/exec)
- [Exec approvals](/tools/exec-approvals)
