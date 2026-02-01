# Zee Usage Examples

Practical examples for common Zee workflows.

## Memory Operations

### Remember Something
```
User: "Remember that Sarah prefers oat milk"
zee: Stores as preference, links to Sarah contact
     Will recall when relevant (coffee orders, restaurant choices)
```

### Store and Search
```bash
# Store a memory
npx tsx scripts/zee-memory.ts store "Meeting with John about Q4 planning" --category task

# Search memories
npx tsx scripts/zee-memory.ts search "John Q4" --limit 5

# Pattern learning
npx tsx scripts/zee-memory.ts patterns --category preference
```

## Messaging

### Coordinate Communication
```
User: "Tell the team I'll be late"
zee: Identifies "team" from context
     Sends appropriate message to each platform
     WhatsApp group, Telegram chat, or email as configured
```

### Multi-platform
```bash
# WhatsApp
npx tsx scripts/zee-messaging.ts whatsapp --to "+1234567890" --message "Running 10 min late"

# Telegram
npx tsx scripts/zee-messaging.ts telegram --to "@username" --message "Check this link"

# Broadcast
npx tsx scripts/zee-messaging.ts broadcast --group "family" --message "Dinner at 7pm"
```

## Calendar & Scheduling

### Smart Scheduling
```
User: "Schedule lunch with John next week"
zee: Checks both calendars (if shared)
     Finds mutual free time
     Proposes options considering travel time
     Creates event with location suggestion
```

### Calendar Commands
```bash
# Sync calendars
vdirsyncer sync

# Today's events
khal list

# Add event
khal new 15:00 16:00 "Meeting with John"

# Interactive TUI
ikhal
```

## Email

### Email Workflow
```bash
# Sync and index
mbsync -a && notmuch new

# Search
notmuch search "from:john@example.com subject:meeting"

# Read (interactive)
neomutt

# Send
neomutt -s "Quick question" someone@example.com
```

## Morning Brief

```
User: "What's my day look like?"
zee: Today's calendar with context
     Pending tasks and reminders
     Unread messages needing response
     Upcoming deadlines
```

## Contacts

```bash
# Search contacts
khard list "john"

# Show contact
khard show "John Doe"

# Add new contact
khard new
```

## PTY Session Examples

### Interactive Python
```bash
# Start interpreter
zee:pty-start { command: "python3 -i" }

# Define function
zee:pty-paste {
  sessionId: "abc123",
  text: "def greet(name):\n    return f'Hello, {name}!'"
}
zee:pty-send-keys { sessionId: "abc123", keys: ["enter", "enter"] }

# Call it
zee:pty-send-keys {
  sessionId: "abc123",
  literal: "greet('World')",
  keys: ["enter"]
}

# Check output
zee:pty-poll { sessionId: "abc123" }
# -> stdout: "'Hello, World!'\n>>>"

# Exit
zee:pty-send-keys { sessionId: "abc123", keys: ["c-d"] }
```

### Vim Editing
```bash
# Start vim
zee:pty-start { command: "vim /tmp/test.txt" }

# Enter insert mode
zee:pty-send-keys { sessionId: "abc123", keys: ["i"] }
zee:pty-send-keys { sessionId: "abc123", literal: "Hello, World!" }

# Exit insert mode
zee:pty-send-keys { sessionId: "abc123", keys: ["escape"] }

# Save and quit
zee:pty-send-keys { sessionId: "abc123", literal: ":wq", keys: ["enter"] }
```

## Browser Automation

### Basic Workflow
```bash
# Check status
zee:browser-status

# Navigate
zee:browser-navigate { url: "https://example.com" }

# Get snapshot
zee:browser-snapshot
# Returns: button[0]: "Submit", textbox[1]: "Search..."

# Interact
zee:browser-click { ref: "button[0]" }
zee:browser-type { ref: "textbox[1]", text: "hello world", submit: true }

# Screenshot
zee:browser-screenshot { fullPage: true }
```

### Multiple Profiles
```bash
# Create profiles
zee:browser-profiles-create { name: "work", color: "#0066CC" }
zee:browser-profiles-create { name: "personal", color: "#00AA00" }

# Work browser
zee:browser-profiles-start { profile: "work" }
zee:browser-navigate { url: "https://mail.google.com", profile: "work" }

# Personal browser (separate session)
zee:browser-profiles-start { profile: "personal" }
zee:browser-navigate { url: "https://mail.google.com", profile: "personal" }
```

## Handheld Node Control

### Take Photo
```bash
zee:node-camera-snap {
  nodeId: "phone-01",
  facing: "back"
}
# -> { format: "jpg", base64: "...", width: 4032, height: 3024 }
```

### Get Location
```bash
zee:node-location {
  nodeId: "phone-01",
  desiredAccuracy: "precise"
}
# -> { latitude: 37.7749, longitude: -122.4194, accuracy: 5 }
```

### Send Notification
```bash
zee:node-notify {
  nodeId: "phone-01",
  title: "Reminder",
  body: "Meeting in 5 minutes",
  priority: "timeSensitive"
}
```

## Cron Jobs

### Daily Standup
```bash
zee:cron-add {
  job: {
    name: "Daily standup",
    schedule: { kind: "cron", expr: "0 9 * * MON-FRI", tz: "America/New_York" },
    payload: { kind: "systemEvent", text: "Morning standup reminder" }
  }
}
```

### Hourly Health Check
```bash
zee:cron-add {
  job: {
    name: "Health check",
    schedule: { kind: "every", everyMs: 3600000 },
    sessionTarget: "isolated",
    payload: { kind: "agentTurn", message: "Run system health check" }
  }
}
```

### One-time Reminder
```bash
zee:cron-add {
  job: {
    name: "Meeting reminder",
    schedule: { kind: "at", atMs: 1706104800000 },
    deleteAfterRun: true,
    payload: { kind: "systemEvent", text: "Meeting with John in 15 minutes" }
  }
}
```

## Delegation

| Need | Delegate To | Example |
|------|-------------|---------|
| Market analysis | @stanley | "What's AAPL doing?" |
| Learning/study | @johny | "Help me understand X" |
| Financial question | @stanley | Domain expertise |
| Code implementation | @johny | Oracle protocol |

```bash
# Delegate via CLI
npx tsx scripts/zee-delegate-cli.ts --to stanley --task "Analyze AAPL" --context "User interested in tech sector"
```
