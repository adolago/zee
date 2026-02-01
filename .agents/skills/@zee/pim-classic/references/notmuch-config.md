# notmuch Configuration

Config file: `~/.config/notmuch/default/config` or `~/.notmuch-config`

## Initial Setup

```bash
# Interactive setup (creates config)
notmuch setup

# Or create manually
notmuch config set database.path ~/.mail
notmuch config set user.name "Your Name"
notmuch config set user.primary_email you@example.com
notmuch config set user.other_email "work@example.com;alias@example.com"

# Initial indexing
notmuch new
```

## Configuration File

```ini
[database]
path=/home/user/.mail

[user]
name=Your Name
primary_email=you@example.com
other_email=work@example.com;alias@example.com

[new]
tags=unread;inbox
ignore=.mbsyncstate;.strstrings

[search]
exclude_tags=deleted;spam

[maildir]
synchronize_flags=true
```

## Common Commands

### Indexing

```bash
# Index new messages
notmuch new

# Full reindex (slow, rarely needed)
notmuch reindex '*'
```

### Searching

```bash
# Basic search
notmuch search "from:john@example.com"
notmuch search "subject:meeting"
notmuch search "to:me@example.com"

# Date ranges
notmuch search "date:2024-01-01..2024-01-31"
notmuch search "date:yesterday.."
notmuch search "date:last_week..today"

# Tags
notmuch search "tag:unread"
notmuch search "tag:inbox AND tag:unread"
notmuch search "NOT tag:spam"

# Attachments
notmuch search "attachment:pdf"
notmuch search "mimetype:image/*"

# Boolean operators
notmuch search "from:john AND subject:urgent"
notmuch search "from:john OR from:jane"
notmuch search "(from:john OR from:jane) AND tag:unread"

# Folder
notmuch search "folder:work/INBOX"
```

### Tagging

```bash
# Add tag
notmuch tag +important -- "from:boss@company.com"

# Remove tag
notmuch tag -unread -- "tag:unread AND date:..1week"

# Multiple tags
notmuch tag +archived -inbox -- "date:..3months AND tag:inbox"

# Tag specific messages
notmuch tag +todo -- id:message-id@example.com
```

### Reading

```bash
# Show message(s)
notmuch show "from:john AND subject:meeting"

# Show as JSON
notmuch show --format=json "id:message-id@example.com"

# Count results
notmuch count "tag:unread"
```

## Auto-tagging with Hooks

Create `~/.config/notmuch/default/hooks/post-new`:

```bash
#!/bin/bash

# Tag mailing lists
notmuch tag +list/linux-kernel -- from:linux-kernel@vger.kernel.org AND tag:new
notmuch tag +list/arch -- to:arch-general@archlinux.org AND tag:new

# Tag work email
notmuch tag +work -- to:work@company.com AND tag:new

# Auto-archive old newsletters
notmuch tag -inbox +archived -- tag:inbox AND tag:newsletter AND date:..1month

# Remove 'new' tag
notmuch tag -new -- tag:new
```

Make executable: `chmod +x ~/.config/notmuch/default/hooks/post-new`

## Integration with neomutt

In neomuttrc:

```muttrc
# notmuch virtual mailboxes
set nm_default_url = "notmuch:///home/user/.mail"
set virtual_spoolfile = yes

virtual-mailboxes \
  "Unread" "notmuch://?query=tag:unread" \
  "Inbox" "notmuch://?query=tag:inbox" \
  "Flagged" "notmuch://?query=tag:flagged" \
  "Sent" "notmuch://?query=tag:sent" \
  "Archive" "notmuch://?query=tag:archived"

# Search shortcut
macro index \Cf "<vfolder-from-query>" "notmuch search"
```

## Address Completion

Extract addresses for completion:

```bash
# Dump all addresses
notmuch address --output=recipients --output=sender '*' | sort -u > ~/.config/neomutt/addresses
```
