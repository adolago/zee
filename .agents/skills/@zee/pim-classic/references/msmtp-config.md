# msmtp Configuration

Config file: `~/.config/msmtp/config` or `~/.msmtprc`

**Important:** Set permissions: `chmod 600 ~/.config/msmtp/config`

## Gmail Example

```ini
defaults
auth           on
tls            on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        ~/.local/share/msmtp/msmtp.log

account        personal
host           smtp.gmail.com
port           587
from           you@gmail.com
user           you@gmail.com
passwordeval   "pass show email/gmail-app-password"

account        default : personal
```

## Fastmail Example

```ini
account        fastmail
host           smtp.fastmail.com
port           587
from           you@fastmail.com
user           you@fastmail.com
passwordeval   "pass show email/fastmail"
```

## Multiple Accounts

```ini
defaults
auth           on
tls            on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        ~/.local/share/msmtp/msmtp.log

account        personal
host           smtp.gmail.com
port           587
from           you@gmail.com
user           you@gmail.com
passwordeval   "pass show email/gmail"

account        work
host           smtp.company.com
port           587
from           you@company.com
user           you@company.com
passwordeval   "pass show email/work"

account        default : personal
```

## Password Storage Options

```ini
# Using pass (recommended)
passwordeval   "pass show email/account"

# Using secret-tool (GNOME Keyring)
passwordeval   "secret-tool lookup host smtp.gmail.com user you@gmail.com"

# Using gpg-encrypted file
passwordeval   "gpg --quiet --batch -d ~/.config/msmtp/password.gpg"

# Plain text (NOT recommended)
password       yourpassword
```

## Usage

```bash
# Send test email
echo "Test body" | msmtp -a personal recipient@example.com

# Send with subject (via mailx syntax)
echo "Test body" | msmtp -a personal -t << EOF
To: recipient@example.com
Subject: Test

Body here
EOF

# Test server connection
msmtp --serverinfo -a personal

# Verbose debug
msmtp -v -a personal recipient@example.com < /dev/null
```

## Troubleshooting

```bash
# Check config syntax
msmtp --pretend -a personal recipient@example.com

# View log
tail -f ~/.local/share/msmtp/msmtp.log

# Common issues:
# - Gmail: Need App Password, not regular password
# - Port 587: Use STARTTLS
# - Port 465: Use tls_starttls off
```
