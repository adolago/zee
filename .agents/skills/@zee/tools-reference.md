# Zee Tools Reference

Detailed documentation for Zee's tools and capabilities.

## Domain Tools Summary

| Tool | Purpose |
|------|---------|
| `zee:memory-store` | Store facts, preferences, tasks, notes |
| `zee:memory-search` | Semantic search across all memories |
| `zee:messaging` | Send text/audio/media across WhatsApp and Telegram |
| `neomutt` | Email client (read, compose, reply) |
| `notmuch` | Email search and indexing |
| `mbsync` | IMAP sync (offline email) |
| `msmtp` | SMTP sending |
| `khal` | Calendar TUI (view, add, edit events) |
| `khard` | Contacts TUI (search, add, edit) |
| `vdirsyncer` | CalDAV/CardDAV sync |
| `zee:notification` | Proactive alerts and reminders |
| `zee:splitwise` | Shared expenses, balances, reimbursements |

## Browser Tools

| Tool | Purpose |
|------|---------|
| `zee:browser-status` | Check browser control server status |
| `zee:browser-snapshot` | Get ARIA accessibility tree with element refs |
| `zee:browser-navigate` | Navigate to URL |
| `zee:browser-click` | Click element by ref (e.g., "button[3]") |
| `zee:browser-type` | Type text into element |
| `zee:browser-fill-form` | Fill multiple form fields at once |
| `zee:browser-screenshot` | Capture page or element screenshot |
| `zee:browser-wait` | Wait for element, text, or URL |
| `zee:browser-tabs` | List open browser tabs |
| `zee:browser-profiles-list` | List all browser profiles with status |
| `zee:browser-profiles-create` | Create new isolated browser profile |
| `zee:browser-profiles-delete` | Delete a browser profile |
| `zee:browser-profiles-start` | Start browser for a specific profile |
| `zee:browser-profiles-stop` | Stop browser for a specific profile |
| `zee:browser-profiles-reset` | Reset profile (clear all cookies/storage) |

### Browser Automation Prerequisites

1. Chrome/Chromium running with remote debugging:
   ```bash
   chromium --remote-debugging-port=9222
   ```
2. Zee gateway running (auto-started by `agent-core daemon`)

**Configuration** (`agent-core.jsonc`):
```json
{
  "zee": {
    "browser": {
      "enabled": true,
      "controlUrl": "http://127.0.0.1:18791",
      "profile": "zee"
    }
  }
}
```

### Browser Tools Workflow

1. **Check status** - `zee:browser-status`
2. **Navigate** - `zee:browser-navigate { url: "https://example.com" }`
3. **Snapshot** - Get ARIA tree with refs like `button[0]`, `textbox[1]`
4. **Interact** - `zee:browser-click { ref: "button[0]" }`
5. **Wait** - `zee:browser-wait { waitFor: "text", value: "Success" }`
6. **Screenshot** - `zee:browser-screenshot { fullPage: true }`

### Browser Profiles

Manage multiple isolated browser contexts:
- Each profile has its own cookies, sessions, localStorage
- Separate CDP port for debugging
- Color for visual distinction

**Workflow:**
1. `zee:browser-profiles-create { name: "work", color: "#0066CC" }`
2. `zee:browser-profiles-start { profile: "work" }`
3. Use browser tools with `{ profile: "work" }`
4. `zee:browser-profiles-stop { profile: "work" }`

## PTY Sessions (Interactive Terminals)

| Tool | Purpose |
|------|---------|
| `zee:pty-start` | Start interactive PTY session |
| `zee:pty-list` | List running and finished sessions |
| `zee:pty-poll` | Poll session for new output |
| `zee:pty-send-keys` | Send keystrokes (arrows, ctrl+c, etc.) |
| `zee:pty-paste` | Paste text with bracketed paste mode |
| `zee:pty-log` | Fetch full session output log |
| `zee:pty-kill` | Terminate a running session |
| `zee:pty-clear` | Clear finished session from registry |

**Use Cases:**
- Interactive interpreters: `python -i`, `node`, `irb`
- Text editors: `vim`, `nano`, `emacs`
- TUI applications: `htop`, `ncdu`, `lazygit`
- Debuggers: `gdb`, `pdb`, `lldb`

**Named Keys:**
| Key | Description |
|-----|-------------|
| `enter`, `tab`, `escape`, `space` | Basic keys |
| `up`, `down`, `left`, `right` | Arrow keys |
| `home`, `end`, `pageup`, `pagedown` | Navigation |
| `f1` - `f12` | Function keys |
| `c-c` | Ctrl+C (SIGINT) |
| `c-d` | Ctrl+D (EOF) |
| `c-z` | Ctrl+Z (SIGTSTP) |

**Configuration:**
- Session TTL: `PI_BASH_JOB_TTL_MS` (default: 30 min)
- Output limit: `PI_BASH_MAX_OUTPUT_CHARS` (default: 200KB)

## Node Hosts (handheld and desktop)

| Tool | Purpose |
|------|---------|
| `zee:node-list` | List connected and paired node hosts |
| `zee:node-describe` | Get detailed node information |
| `zee:node-pending` | List pending pairing requests |
| `zee:node-approve` | Approve node pairing request |
| `zee:node-reject` | Reject node pairing request |
| `zee:node-camera-snap` | Take photo (front/back/both camera) |
| `zee:node-camera-clip` | Record video clip |
| `zee:node-screen-record` | Record device screen |
| `zee:node-location` | Get GPS coordinates |
| `zee:node-notify` | Send push notification |
| `zee:node-run` | Execute command on a node host that supports system.run |

**Capability groups (vary by host):**
- **Handheld nodes**: Canvas, Camera, Screen, Location, Notifications (optional SMS if provided by the host).
- **Desktop nodes**: Canvas, Screen, System commands; optional camera/location depending on hardware.
- **Headless nodes**: System commands only.

**Camera Options:**
| Option | Description |
|--------|-------------|
| `facing` | "front", "back", or "both" |
| `maxWidth` | Max image width in pixels |
| `quality` | JPEG quality (0-100) |
| `delayMs` | Delay before capture |

**Location Accuracy:**
| Level | Description |
|-------|-------------|
| `coarse` | ~3km accuracy, low power |
| `balanced` | ~100m accuracy (default) |
| `precise` | ~10m accuracy, high power |

**Notification Priority:**
| Priority | Behavior |
|----------|----------|
| `passive` | Silent, appears in notification center |
| `active` | Sound/vibration (default) |
| `timeSensitive` | Breaks through Do Not Disturb |

**Storage:**
- Pairing state: `~/.zee/nodes/paired.json`
- Pending requests: `~/.zee/nodes/pending.json` (5 min TTL)

## Cron Scheduling

| Tool | Purpose |
|------|---------|
| `zee:cron-status` | Check cron scheduler status |
| `zee:cron-list` | List all configured cron jobs |
| `zee:cron-add` | Create a new cron job |
| `zee:cron-update` | Update an existing cron job |
| `zee:cron-remove` | Remove a cron job |
| `zee:cron-run` | Manually trigger a cron job |
| `zee:cron-runs` | Get run history for a cron job |
| `zee:cron-wake` | Send a wake event to the agent |

**Schedule Types:**
- **cron**: Standard cron expressions (e.g., `0 9 * * *`)
- **every**: Intervals in milliseconds
- **at**: One-time run at specific timestamp

**Payload Types:**
- **systemEvent**: Inject text into agent context
- **agentTurn**: Run agent with specific message

**Configuration** (`agent-core.jsonc`):
```json
{
  "zee": {
    "cron": {
      "enabled": true,
      "store": "~/.local/state/agent-core/cron.json",
      "maxConcurrentRuns": 3
    }
  }
}
```

## Restart Sentinel (Stay-Up)

| Tool | Purpose |
|------|---------|
| `zee:sentinel-status` | Check restart sentinel status |
| `zee:sentinel-save` | Manually save session state |
| `zee:sentinel-restore` | Restore session state |
| `zee:sentinel-search` | Search similar past sessions |

Never lose context when the daemon restarts:
- Captures session state on shutdown
- Stores in Qdrant with semantic embeddings
- Automatically restores on startup

**Configuration** (`agent-core.jsonc`):
```json
{
  "memory": {
    "qdrant": { "url": "http://localhost:6333" },
    "embedding": { "profile": "google/gemini-embedding-001" }
  }
}
```

## Claude Code Integration

| Tool | Purpose |
|------|---------|
| `zee:claude-status` | Check Claude Code CLI availability |
| `zee:claude-spawn` | Spawn Claude Code with a prompt |
| `zee:claude-credentials` | Check OAuth credential details |

Spawn Claude Code CLI as a subprocess with shared skills and MCP servers.

**Prerequisites:**
1. Claude Code installed: `npm install -g @anthropic-ai/claude-code`
2. Authenticated: `claude login`

## Daemon Installation

Install agent-core daemon as a system service:

```bash
# Interactive wizard
agent-core daemon-install

# With options
agent-core daemon-install --port 3210 --gateway

# Check status
agent-core daemon-service-status

# Uninstall
agent-core daemon-uninstall
```

**Options:**
| Option | Description |
|--------|-------------|
| `--port` | Daemon port (default: 3210) |
| `--gateway` | Enable zee messaging gateway |
| `--wezterm` | Enable WezTerm orchestration |

**Service Locations:**
- Linux: `~/.config/systemd/user/agent-core-daemon.service`

**Log Locations:**
- `~/.local/state/agent-core/logs/daemon.log`
- `~/.local/state/agent-core/logs/daemon.err.log`

## Splitwise (Shared Expenses)

Track shared expenses via Splitwise API (OAuth token required).
Enable with `zee.splitwise.enabled` in `agent-core.jsonc`.

```bash
# List groups
curl -H "Authorization: Bearer $SPLITWISE_TOKEN" \
  "https://secure.splitwise.com/api/v3.0/get_groups"
```
