# vdirsyncer Configuration

Config file: `~/.config/vdirsyncer/config`

## Initial Setup

```bash
mkdir -p ~/.local/share/vdirsyncer/{calendars,contacts}
```

## Google Calendar + Contacts

```ini
[general]
status_path = "~/.local/share/vdirsyncer/status/"

# --- CALENDARS ---

[pair google_calendar]
a = "google_calendar_local"
b = "google_calendar_remote"
collections = ["from a", "from b"]
metadata = ["color"]

[storage google_calendar_local]
type = "filesystem"
path = "~/.local/share/vdirsyncer/calendars/google/"
fileext = ".ics"

[storage google_calendar_remote]
type = "google_calendar"
token_file = "~/.config/vdirsyncer/google_token"
client_id = "YOUR_CLIENT_ID.apps.googleusercontent.com"
client_secret = "YOUR_CLIENT_SECRET"

# --- CONTACTS ---

[pair google_contacts]
a = "google_contacts_local"
b = "google_contacts_remote"
collections = ["from a", "from b"]

[storage google_contacts_local]
type = "filesystem"
path = "~/.local/share/vdirsyncer/contacts/google/"
fileext = ".vcf"

[storage google_contacts_remote]
type = "google_contacts"
token_file = "~/.config/vdirsyncer/google_contacts_token"
client_id = "YOUR_CLIENT_ID.apps.googleusercontent.com"
client_secret = "YOUR_CLIENT_SECRET"
```

## Fastmail (CalDAV/CardDAV)

```ini
[general]
status_path = "~/.local/share/vdirsyncer/status/"

# --- CALENDAR ---

[pair fastmail_calendar]
a = "fastmail_calendar_local"
b = "fastmail_calendar_remote"
collections = ["from a", "from b"]
metadata = ["color"]

[storage fastmail_calendar_local]
type = "filesystem"
path = "~/.local/share/vdirsyncer/calendars/fastmail/"
fileext = ".ics"

[storage fastmail_calendar_remote]
type = "caldav"
url = "https://caldav.fastmail.com/"
username = "you@fastmail.com"
password.fetch = ["command", "pass", "show", "email/fastmail"]

# --- CONTACTS ---

[pair fastmail_contacts]
a = "fastmail_contacts_local"
b = "fastmail_contacts_remote"
collections = ["from a", "from b"]

[storage fastmail_contacts_local]
type = "filesystem"
path = "~/.local/share/vdirsyncer/contacts/fastmail/"
fileext = ".vcf"

[storage fastmail_contacts_remote]
type = "carddav"
url = "https://carddav.fastmail.com/"
username = "you@fastmail.com"
password.fetch = ["command", "pass", "show", "email/fastmail"]
```

## iCloud

```ini
[pair icloud_calendar]
a = "icloud_calendar_local"
b = "icloud_calendar_remote"
collections = ["from a", "from b"]

[storage icloud_calendar_local]
type = "filesystem"
path = "~/.local/share/vdirsyncer/calendars/icloud/"
fileext = ".ics"

[storage icloud_calendar_remote]
type = "caldav"
url = "https://caldav.icloud.com/"
username = "appleid@example.com"
password.fetch = ["command", "pass", "show", "apple/app-specific"]

[pair icloud_contacts]
a = "icloud_contacts_local"
b = "icloud_contacts_remote"
collections = ["from a", "from b"]

[storage icloud_contacts_local]
type = "filesystem"
path = "~/.local/share/vdirsyncer/contacts/icloud/"
fileext = ".vcf"

[storage icloud_contacts_remote]
type = "carddav"
url = "https://contacts.icloud.com/"
username = "appleid@example.com"
password.fetch = ["command", "pass", "show", "apple/app-specific"]
```

## Password Options

```ini
# Using pass
password.fetch = ["command", "pass", "show", "email/account"]

# Using secret-tool
password.fetch = ["command", "secret-tool", "lookup", "service", "vdirsyncer", "account", "fastmail"]

# Prompt (not recommended for automation)
password.fetch = ["prompt", "Fastmail password"]
```

## Usage

```bash
# First time: discover collections
vdirsyncer discover

# Sync all
vdirsyncer sync

# Sync specific pair
vdirsyncer sync google_calendar
vdirsyncer sync google_contacts

# Force full sync
vdirsyncer sync --force-delete

# Repair (after errors)
vdirsyncer repair
```

## Google OAuth Setup

1. Go to https://console.cloud.google.com/
2. Create project, enable Calendar API and People API
3. Create OAuth 2.0 credentials (Desktop app)
4. Download JSON, extract client_id and client_secret
5. Run `vdirsyncer discover` - will open browser for auth
6. Token saved to `token_file` path

## Automation

```bash
# Cron (every 15 min)
*/15 * * * * vdirsyncer sync

# Systemd timer
# ~/.config/systemd/user/vdirsyncer.service
[Unit]
Description=Sync calendars and contacts

[Service]
Type=oneshot
ExecStart=/usr/bin/vdirsyncer sync

# ~/.config/systemd/user/vdirsyncer.timer
[Timer]
OnBootSec=5min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
```
