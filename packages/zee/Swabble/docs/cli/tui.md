---
summary: "CLI reference for `zee tui` (terminal UI connected to the Gateway)"
read_when:
  - You want a terminal UI for the Gateway (remote-friendly)
  - You want to pass url/token/session from scripts
---

# `zee tui`

Open the terminal UI (Zee TUI). `zee tui` starts the UI and connects to the server.

Related:
- TUI guide: [TUI](/tui)

## Examples

```bash
zee
ZEE_URL=http://127.0.0.1:3210 zee
zee tui --session main
```
