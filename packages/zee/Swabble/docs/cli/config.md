---
summary: "CLI reference for `zee config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
---

# `zee config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `zee configure`).

## Examples

```bash
zee config get browser.executablePath
zee config set browser.executablePath "/usr/bin/google-chrome"
zee config set agents.defaults.heartbeat.every "2h"
zee config set agents.list[0].tools.exec.node "node-id-or-name"
zee config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
zee config get agents.defaults.workspace
zee config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
zee config get agents.list
zee config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
zee config set agents.defaults.heartbeat.every "0m"
zee config set gateway.port 19001 --json
zee config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
