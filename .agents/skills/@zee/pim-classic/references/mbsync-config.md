# mbsync (isync) Configuration

Config file: `~/.mbsyncrc` or `~/.config/mbsync/config`

## Gmail Example

```ini
# IMAP Account
IMAPAccount gmail
Host imap.gmail.com
User you@gmail.com
PassCmd "pass show email/gmail-app-password"
SSLType IMAPS
CertificateFile /etc/ssl/certs/ca-certificates.crt

# Remote storage
IMAPStore gmail-remote
Account gmail

# Local storage
MaildirStore gmail-local
Subfolders Verbatim
Path ~/.mail/gmail/
Inbox ~/.mail/gmail/INBOX

# Sync channels
Channel gmail
Far :gmail-remote:
Near :gmail-local:
Patterns * ![Gmail]* "[Gmail]/Sent Mail" "[Gmail]/Drafts" "[Gmail]/Trash"
Create Both
Expunge Both
SyncState *
```

## Fastmail Example

```ini
IMAPAccount fastmail
Host imap.fastmail.com
User you@fastmail.com
PassCmd "pass show email/fastmail"
SSLType IMAPS
CertificateFile /etc/ssl/certs/ca-certificates.crt

IMAPStore fastmail-remote
Account fastmail

MaildirStore fastmail-local
Subfolders Verbatim
Path ~/.mail/fastmail/
Inbox ~/.mail/fastmail/INBOX

Channel fastmail
Far :fastmail-remote:
Near :fastmail-local:
Patterns *
Create Both
Expunge Both
SyncState *
```

## Multiple Accounts

```ini
# Personal account
IMAPAccount personal
Host imap.gmail.com
...

# Work account
IMAPAccount work
Host imap.company.com
...

Channel personal
...

Channel work
...

# Sync all with: mbsync -a
# Sync one with: mbsync personal
```

## Common Options

| Option | Description |
|--------|-------------|
| `PassCmd` | Command to get password (use pass, secret-tool, etc.) |
| `SSLType` | `IMAPS` (port 993) or `STARTTLS` (port 143) |
| `Patterns` | Which folders to sync (`*` = all, `!folder` = exclude) |
| `Create Both` | Create missing folders on both sides |
| `Expunge Both` | Actually delete messages marked for deletion |
| `SyncState *` | Store sync state per-folder |

## Usage

```bash
# Sync all accounts
mbsync -a

# Sync specific account
mbsync personal

# Sync specific channel
mbsync personal:INBOX

# Verbose output
mbsync -V -a

# Dry run
mbsync -n -a
```
