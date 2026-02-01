# Bitwarden CLI Commands Reference

## Authentication

```bash
# Login (first time - interactive)
bw login

# Login with email (will prompt for password)
bw login user@example.com

# Login with API key (non-interactive)
bw login --apikey
# Requires BW_CLIENTID and BW_CLIENTSECRET env vars

# Logout
bw logout

# Check login status
bw status
```

## Vault Lock/Unlock

```bash
# Unlock (returns session key)
bw unlock

# Unlock and get raw session key (for export)
bw unlock --raw

# Unlock with password from stdin
echo "masterpassword" | bw unlock --raw

# Lock vault
bw lock
```

## Sync

```bash
# Sync vault with server
bw sync

# Force full sync
bw sync --force
```

## Get Items

```bash
# Get item by name or ID
bw get item "Item Name"
bw get item 12345678-1234-1234-1234-123456789012

# Get specific fields
bw get username "Item Name"
bw get password "Item Name"
bw get totp "Item Name"
bw get uri "Item Name"
bw get notes "Item Name"

# Get exposed passwords report
bw get exposed <password>

# Get attachment
bw get attachment <filename> --itemid <id> --output ./file.txt
```

## List Items

```bash
# List all items
bw list items

# Search items
bw list items --search "query"

# Filter by collection
bw list items --collectionid <id>

# Filter by folder
bw list items --folderid <id>

# Filter by organization
bw list items --organizationid <id>

# List specific types
bw list items --trash  # Trashed items

# List folders
bw list folders

# List collections
bw list collections

# List organizations
bw list organizations

# List org members
bw list org-members --organizationid <id>
```

## Create Items

```bash
# Get template for item type
bw get template item.login
bw get template item.secureNote
bw get template item.card
bw get template item.identity

# Create from template
bw get template item.login | \
  jq '.name="New Login" | .login.username="user" | .login.password="pass" | .login.uris=[{"uri":"https://example.com"}]' | \
  bw encode | \
  bw create item

# Create folder
echo '{"name":"New Folder"}' | bw encode | bw create folder
```

## Edit Items

```bash
# Edit item (get current, modify, update)
bw get item <id> | \
  jq '.login.password="newpassword"' | \
  bw encode | \
  bw edit item <id>

# Move to folder
bw get item <id> | \
  jq '.folderId="folder-id"' | \
  bw encode | \
  bw edit item <id>
```

## Delete Items

```bash
# Move to trash
bw delete item <id>

# Permanently delete
bw delete item <id> --permanent

# Delete folder
bw delete folder <id>

# Delete attachment
bw delete attachment <attachment-id> --itemid <item-id>
```

## Generate Passwords

```bash
# Generate random password
bw generate

# With options
bw generate --length 20 --uppercase --lowercase --number --special

# Passphrase
bw generate --passphrase --words 4 --separator "-"
```

## Encode/Decode

```bash
# Encode JSON for create/edit operations
echo '{"name":"test"}' | bw encode
# Output: eyJuYW1lIjoidGVzdCJ9

# Decode (not commonly needed)
# The CLI handles decoding internally
```

## Configuration

```bash
# Set server URL (for self-hosted)
bw config server https://bitwarden.example.com

# View config
bw config server
```

## Output Formats

```bash
# Default: JSON
bw list items

# Pretty JSON (use jq)
bw list items | jq

# Get specific fields with jq
bw list items | jq -r '.[].name'
bw get item "GitHub" | jq -r '.login.password'
```
