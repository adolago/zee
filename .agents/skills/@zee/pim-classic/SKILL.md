---
name: pim-classic
description: "Classic Unix PIM stack: neomutt (email), mbsync (IMAP sync), msmtp (SMTP), notmuch (search), vdirsyncer (CalDAV/CardDAV), khal (calendar), khard (contacts). Provider-agnostic, offline-first, battle-tested."
version: 1.0.0
author: Artur
tags: [email, calendar, contacts, zee]
homepage: https://neomutt.org
metadata: {"zee":{"emoji":"📬","requires":{"bins":["neomutt","mbsync","msmtp","notmuch","vdirsyncer","khal","khard"]},"install":[{"id":"pacman","kind":"pacman","packages":["neomutt","isync","msmtp","notmuch","vdirsyncer","khal","khard"],"label":"Install PIM stack (pacman)"}]}}
---

# Classic Unix PIM Stack

Battle-tested, provider-agnostic personal information management for email, calendar, and contacts.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         PROVIDERS                                │
│   Gmail, Fastmail, iCloud, ProtonMail, self-hosted, any IMAP    │
└──────────────┬─────────────────────────────────┬────────────────┘
               │ IMAP/SMTP                       │ CalDAV/CardDAV
               ▼                                 ▼
┌──────────────────────────┐       ┌──────────────────────────────┐
│  mbsync (isync)          │       │  vdirsyncer                  │
│  IMAP ↔ Maildir sync     │       │  CalDAV/CardDAV ↔ local      │
└──────────┬───────────────┘       └──────────┬───────────────────┘
           │                                  │
           ▼                                  ▼
┌──────────────────────────┐       ┌──────────────────────────────┐
│  Maildir (~/.mail/)      │       │  ~/.local/share/vdirsyncer/  │
│  + notmuch (indexing)    │       │  calendars/ + contacts/      │
└──────────┬───────────────┘       └──────────┬───────────────────┘
           │                                  │
           ▼                                  ▼
┌──────────────────────────┐       ┌──────────────────────────────┐
│  neomutt                 │       │  khal (calendar)             │
│  (email client)          │       │  khard (contacts)            │
│  + msmtp (sending)       │       │                              │
└──────────────────────────┘       └──────────────────────────────┘
```

## Installation

```bash
# Arch Linux
sudo pacman -S neomutt isync msmtp notmuch vdirsyncer khal khard

# Create directories
mkdir -p ~/.mail ~/.config/{neomutt,mbsync,msmtp,notmuch,vdirsyncer,khal,khard}
mkdir -p ~/.local/share/vdirsyncer/{calendars,contacts}
```

## References

- `references/mbsync-config.md` - IMAP sync configuration
- `references/neomutt-config.md` - Email client configuration
- `references/msmtp-config.md` - SMTP sending configuration
- `references/notmuch-config.md` - Email search/indexing
- `references/vdirsyncer-config.md` - CalDAV/CardDAV sync
- `references/khal-config.md` - Calendar TUI
- `references/khard-config.md` - Contacts TUI

---

## Email: mbsync + neomutt + msmtp + notmuch

### Sync Email (mbsync)

```bash
# Sync all accounts
mbsync -a

# Sync specific account
mbsync personal

# Sync specific folder
mbsync personal:INBOX
```

### Read/Send Email (neomutt)

```bash
# Open neomutt
neomutt

# Open specific mailbox
neomutt -f ~/.mail/personal/INBOX
```

**Key bindings (default):**
| Key | Action |
|-----|--------|
| `j/k` | Navigate |
| `Enter` | Open message |
| `m` | Compose new |
| `r` | Reply |
| `g` | Group reply |
| `f` | Forward |
| `d` | Delete |
| `s` | Save to folder |
| `/` | Search |
| `q` | Quit |

### Search Email (notmuch)

```bash
# Index mail (run after mbsync)
notmuch new

# Search
notmuch search "from:john@example.com"
notmuch search "subject:meeting date:2024-01-01..2024-01-31"
notmuch search "tag:unread"

# Show message
notmuch show <message-id>

# Tag messages
notmuch tag +important -- "subject:urgent"
```

### Send Email (msmtp)

Usually called by neomutt automatically, but can be used directly:

```bash
# Send via msmtp
echo "Test body" | msmtp -a personal recipient@example.com

# Test configuration
msmtp --serverinfo -a personal
```

---

## Calendar: vdirsyncer + khal

### Sync Calendar (vdirsyncer)

```bash
# Discover calendars (first time)
vdirsyncer discover

# Sync all
vdirsyncer sync

# Sync specific collection
vdirsyncer sync calendars
```

### View/Manage Calendar (khal)

```bash
# Interactive TUI
khal interactive
# or just
ikhal

# List today's events
khal list

# List events for date range
khal list 2024-01-01 2024-01-31

# Add event
khal new 2024-01-15 15:00 16:00 "Meeting with John"

# Add event with calendar
khal new -a personal 2024-01-15 15:00 16:00 "Meeting with John"

# Edit event
khal edit "Meeting"

# Import .ics file
khal import event.ics
```

**khal interactive keys:**
| Key | Action |
|-----|--------|
| `n` | New event |
| `e` | Edit event |
| `d` | Delete event |
| `t` | Jump to today |
| `arrows` | Navigate |
| `q` | Quit |

---

## Contacts: vdirsyncer + khard

### Sync Contacts (vdirsyncer)

```bash
# Already synced with vdirsyncer sync
vdirsyncer sync contacts
```

### View/Manage Contacts (khard)

```bash
# List all contacts
khard list

# Search contacts
khard list "john"

# Show contact details
khard show "John Doe"

# Add new contact
khard new

# Edit contact
khard edit "John Doe"

# Export vCard
khard export "John Doe" > john.vcf

# Import vCard
khard import john.vcf
```

---

## Common Workflows

### Morning Email Check

```bash
# Sync and index
mbsync -a && notmuch new

# Open neomutt
neomutt
```

### Check Today's Schedule

```bash
# Sync calendar
vdirsyncer sync calendars

# View today
khal list today

# Or interactive
ikhal
```

### Find Contact and Email Them

```bash
# Find contact
khard show "Sarah"

# Compose email (neomutt will open)
neomutt -s "Quick question" sarah@example.com
```

### Search Old Emails

```bash
notmuch search "from:client@example.com subject:invoice date:2023"
```

### Quick Event Add

```bash
khal new tomorrow 14:00 15:00 "Call with team" :: "Discuss Q4 planning"
```

---

## Provider-Specific Setup

### Gmail

Requires App Password (not regular password):
1. Go to https://myaccount.google.com/apppasswords
2. Generate app password for "Mail"
3. Use in mbsync/msmtp config

CalDAV/CardDAV URLs:
- Calendar: `https://apidata.googleusercontent.com/caldav/v2/`
- Contacts: `https://www.googleapis.com/carddav/v1/principals/EMAIL/lists/default/`

### Fastmail

- IMAP: `imap.fastmail.com:993`
- SMTP: `smtp.fastmail.com:587`
- CalDAV: `https://caldav.fastmail.com/`
- CardDAV: `https://carddav.fastmail.com/`

### iCloud

Requires App-Specific Password:
- IMAP: `imap.mail.me.com:993`
- SMTP: `smtp.mail.me.com:587`
- CalDAV: `https://caldav.icloud.com/`
- CardDAV: `https://contacts.icloud.com/`

---

## Automation

### Cron Sync (every 5 minutes)

```bash
# Add to crontab -e
*/5 * * * * mbsync -a && notmuch new
*/15 * * * * vdirsyncer sync
```

### Systemd Timer (preferred)

```bash
# ~/.config/systemd/user/mail-sync.service
[Unit]
Description=Sync mail

[Service]
Type=oneshot
ExecStart=/usr/bin/mbsync -a
ExecStartPost=/usr/bin/notmuch new

# ~/.config/systemd/user/mail-sync.timer
[Unit]
Description=Sync mail every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
```

```bash
systemctl --user enable --now mail-sync.timer
```

---

## Tips

- **Offline-first**: All data stored locally, sync when online
- **Encrypted passwords**: Use `pass` or `secret-tool` for credentials
- **Backup**: Just backup `~/.mail/` and `~/.local/share/vdirsyncer/`
- **Multiple accounts**: Each tool supports multiple accounts/calendars
- **Integration**: neomutt can query khard for address completion
