# neomutt Configuration

Config file: `~/.config/neomutt/neomuttrc` or `~/.neomuttrc`

## Basic Configuration

```muttrc
# Identity
set realname = "Your Name"
set from = "you@example.com"

# Maildir
set mbox_type = Maildir
set folder = "~/.mail/personal"
set spoolfile = "+INBOX"
set record = "+Sent"
set postponed = "+Drafts"
set trash = "+Trash"

# Sending (via msmtp)
set sendmail = "msmtp -a personal"
set use_from = yes
set envelope_from = yes

# Index format
set index_format = "%4C %Z %{%b %d} %-20.20L (%4c) %s"
set sort = threads
set sort_aux = reverse-last-date-received

# Pager
set pager_index_lines = 10
set pager_context = 3
set pager_stop = yes

# Editor
set editor = "nvim"

# Sidebar (optional)
set sidebar_visible = yes
set sidebar_width = 30
set sidebar_format = "%B%?F? [%F]?%* %?N?%N/?%S"
bind index,pager \CP sidebar-prev
bind index,pager \CN sidebar-next
bind index,pager \CO sidebar-open

# Address book (khard integration)
set query_command = "khard email --parsable %s"
bind editor <Tab> complete-query

# notmuch integration
set nm_default_url = "notmuch:///home/user/.mail"
set virtual_spoolfile = yes
virtual-mailboxes "Unread" "notmuch://?query=tag:unread"
virtual-mailboxes "Flagged" "notmuch://?query=tag:flagged"
```

## Multiple Accounts

```muttrc
# Account switching
folder-hook 'personal' 'source ~/.config/neomutt/accounts/personal.muttrc'
folder-hook 'work' 'source ~/.config/neomutt/accounts/work.muttrc'

# Mailboxes
named-mailboxes "Personal" "+personal/INBOX"
named-mailboxes "Work" "+work/INBOX"

# Default account
source ~/.config/neomutt/accounts/personal.muttrc
```

Per-account file (`~/.config/neomutt/accounts/personal.muttrc`):
```muttrc
set realname = "Your Name"
set from = "you@gmail.com"
set folder = "~/.mail/personal"
set spoolfile = "+INBOX"
set sendmail = "msmtp -a personal"
```

## Key Bindings

```muttrc
# Vim-like
bind index j next-entry
bind index k previous-entry
bind index g noop
bind index gg first-entry
bind index G last-entry

bind pager j next-line
bind pager k previous-line
bind pager g noop
bind pager gg top
bind pager G bottom

# Quick sync
macro index S "<shell-escape>mbsync -a && notmuch new<enter>" "Sync mail"

# Archive
macro index A "<save-message>+Archive<enter>" "Archive message"

# Open URLs
macro pager \Cu "<pipe-message>urlscan<enter>" "Open URLs"
```

## Colors (gruvbox-ish)

```muttrc
color normal      white         default
color indicator   black         yellow
color tree        cyan          default
color status      white         blue
color error       red           default
color message     green         default

color hdrdefault  cyan          default
color header      yellow        default "^(From|Subject|Date):"
color quoted      green         default
color quoted1     cyan          default
color signature   brightblack   default

color index       red           default "~D"  # deleted
color index       yellow        default "~F"  # flagged
color index       green         default "~N"  # new
color index       cyan          default "~T"  # tagged
```

## Usage

```bash
# Open default mailbox
neomutt

# Open specific mailbox
neomutt -f ~/.mail/work/INBOX

# Compose new email
neomutt -s "Subject" recipient@example.com

# With attachment
neomutt -s "Subject" -a file.pdf -- recipient@example.com
```
