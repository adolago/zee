# khard Configuration

Config file: `~/.config/khard/khard.conf`

## Basic Configuration

```ini
[addressbooks]

[[personal]]
path = ~/.local/share/vdirsyncer/contacts/google/default/

[[work]]
path = ~/.local/share/vdirsyncer/contacts/fastmail/default/

[general]
default_action = list
editor = nvim
merge_editor = vimdiff

[contact table]
display = first_name
group_by_addressbook = yes
reverse = no
show_nicknames = yes
show_uids = no
sort = first_name
localize_dates = yes

[vcard]
private_objects =
preferred_version = 3.0
search_in_source_files = no
skip_unparsable = no
```

## Auto-discover Address Books

```ini
[addressbooks]

[[google]]
path = ~/.local/share/vdirsyncer/contacts/google/
type = discover

[[fastmail]]
path = ~/.local/share/vdirsyncer/contacts/fastmail/
type = discover
```

## Commands

### List Contacts

```bash
# List all
khard list

# Search
khard list "john"

# Show specific contact
khard show "John Doe"

# Show with all fields
khard show --format yaml "John Doe"
```

### Add Contact

```bash
# Interactive (opens editor with template)
khard new

# To specific address book
khard new -a work

# From template
khard new -i template.vcf
```

Template format (YAML):
```yaml
First name: John
Last name: Doe
Nickname: johnny
Email:
    home: john.doe@gmail.com
    work: jdoe@company.com
Phone:
    cell: +1-555-123-4567
    home: +1-555-987-6543
Address:
    home:
        Street: 123 Main St
        City: Anytown
        State: CA
        Zip: 12345
        Country: USA
Birthday: 1990-05-15
Note: Met at conference 2023
Categories: friends, conference
```

### Edit Contact

```bash
# Edit (opens in editor)
khard edit "John Doe"

# Merge duplicates
khard merge "John Doe" "Johnny D"
```

### Delete Contact

```bash
khard delete "John Doe"

# Force (no confirmation)
khard delete --force "John Doe"
```

### Import/Export

```bash
# Import vCard
khard import john.vcf

# Import to specific addressbook
khard import -a work colleague.vcf

# Export single contact
khard export "John Doe" > john.vcf

# Export all
khard export > all_contacts.vcf
```

### Copy/Move

```bash
# Copy to another addressbook
khard copy "John Doe" -a work

# Move to another addressbook
khard move "John Doe" -a archive
```

## Email Integration (neomutt)

In `~/.config/neomutt/neomuttrc`:

```muttrc
# Query khard for address completion
set query_command = "khard email --parsable %s"

# Tab to complete address
bind editor <Tab> complete-query

# Add sender to khard
macro index,pager A \
  "<pipe-message>khard add-email<return>" \
  "Add sender to khard"
```

Now in neomutt:
- Type part of name in To/Cc field
- Press Tab to autocomplete from khard
- Press A on a message to add sender to contacts

## Output Formats

```bash
# Parsable (for scripts)
khard email --parsable "john"
# Output: john@example.com	John	Doe

# Just emails
khard email "john"

# Phone numbers
khard phone "john"

# As vCard
khard show --format vcard "John Doe"

# As YAML
khard show --format yaml "John Doe"
```

## Useful Aliases

```bash
# ~/.bashrc or ~/.zshrc
alias contacts="khard list"
alias contact="khard show"
alias newcontact="khard new"
```

## Scripting

```bash
# Find all work emails
khard email --parsable -a work | cut -f1

# Birthday reminder
khard birthdays --parsable | while read line; do
  name=$(echo "$line" | cut -f2)
  date=$(echo "$line" | cut -f1)
  echo "Birthday: $name on $date"
done

# Export all to JSON (via yq)
khard show --format yaml "*" | yq -o json
```
