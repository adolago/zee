---
name: caldav-calendar
description: Sync and query CalDAV calendars (iCloud, Google, Fastmail, Nextcloud, etc.) using vdirsyncer + khal. Works on Linux.
version: 1.0.1
author: Asleep123
tags: [calendar, caldav, scheduling]
source: clawhub
metadata: {"clawhub":{"id":"Asleep123/caldav-calendar","requires":{"bins":["vdirsyncer","khal"]}}}
---

# CalDAV Calendar

Sync and query CalDAV calendars using `vdirsyncer` (sync) + `khal` (CLI calendar).

Supports iCloud, Google Calendar, Fastmail, Nextcloud, and any CalDAV-compliant server.

## Prerequisites

```bash
# Install on Linux
pip install vdirsyncer khal

# Or via system package manager
sudo pacman -S vdirsyncer python-khal  # Arch
sudo apt install vdirsyncer khal       # Debian/Ubuntu
```

## Setup

### 1. Configure vdirsyncer

Edit `~/.config/vdirsyncer/config`:

```ini
[general]
status_path = "~/.local/share/vdirsyncer/status/"

[pair my_calendar]
a = "my_calendar_local"
b = "my_calendar_remote"
collections = ["from a", "from b"]

[storage my_calendar_local]
type = "filesystem"
path = "~/.local/share/calendars/"
fileext = ".ics"

[storage my_calendar_remote]
type = "caldav"
url = "https://caldav.example.com/user/calendars/"
username = "user@example.com"
password.fetch = ["command", "pass", "show", "caldav-password"]
```

### 2. Initial sync

```bash
vdirsyncer discover my_calendar
vdirsyncer sync
```

### 3. Configure khal

Edit `~/.config/khal/config`:

```ini
[calendars]

[[my_calendar]]
path = ~/.local/share/calendars/*
type = discover

[locale]
timeformat = %H:%M
dateformat = %Y-%m-%d
longdateformat = %Y-%m-%d
datetimeformat = %Y-%m-%d %H:%M
longdatetimeformat = %Y-%m-%d %H:%M
```

## Common Commands

```bash
# Sync calendars
vdirsyncer sync

# View today's agenda
khal list

# View specific date range
khal list 2026-02-01 2026-02-07

# View calendar (monthly)
khal calendar

# Create event
khal new 2026-02-15 14:00 15:00 "Meeting with John"

# Create all-day event
khal new 2026-02-20 "Day off"

# Search events
khal search "meeting"

# Interactive editor
khal interactive
```

## Automation

```bash
# Cron sync every 15 minutes
*/15 * * * * vdirsyncer sync > /dev/null 2>&1
```

## Notes

- vdirsyncer handles sync; khal handles display/creation
- This integrates with the `pim-classic` skill which covers the full PIM stack
- For Google Calendar: use OAuth2 via vdirsyncer's `google_*` storage types
- For iCloud: use app-specific passwords
- Calendar data is stored locally as .ics files -- works offline after sync
