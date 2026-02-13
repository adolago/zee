---
name: obsidian-cli
description: Obsidian 1.12+ official CLI for vault automation, search, daily notes, and developer tools.
version: 1.0.0
author: Artur
tags:
  - obsidian
  - cli
  - notes
  - automation
triggers:
  - obsidian
  - vault
  - daily note
  - obsidian cli
---

# Obsidian CLI (Official, v1.12+)

The official Obsidian CLI connects to a running Obsidian instance via IPC.
Requires Obsidian 1.12+ with CLI enabled in Settings > General.

## Setup (Arch Linux)

Binary: `/home/artur/.local/bin/obsidian` (custom wrapper)
Vault: SB_FTL at `/home/artur/SB_FTL`

The wrapper bypasses `/usr/bin/electron39` to avoid flag injection that breaks
CLI arg parsing. GUI mode includes electron-flags.conf; CLI mode omits them.

**Prerequisite**: Obsidian must be running. If not, launch it first.

## Quick Reference

```bash
# Basics
obsidian version
obsidian help
obsidian vault

# Daily notes
obsidian daily                              # Open today's daily note
obsidian daily:read                         # Read daily note contents
obsidian daily:append content="- [ ] Task"  # Append to daily note
obsidian daily:prepend content="# Header"   # Prepend to daily note

# Files
obsidian read file=Recipe                   # Read by name (wikilink resolution)
obsidian read path="Work/notes.md"          # Read by exact path
obsidian create name=Note content="Hello"   # Create a note
obsidian create name=Note template=Travel   # Create from template
obsidian open file=Recipe                   # Open in Obsidian
obsidian delete file=Old                    # Delete (to trash)
obsidian move file=Old to="Archive"         # Move/rename
obsidian append file=Log content="Entry"    # Append to file
obsidian prepend file=Log content="Header"  # Prepend to file

# Search
obsidian search query="meeting notes"               # Search vault
obsidian search query="TODO" matches                 # Show match context
obsidian search query="project" path="Work" limit=10 # Scoped search
obsidian search query="test" format=json             # JSON output

# Tasks
obsidian tasks daily                        # Tasks from daily note
obsidian tasks daily todo                   # Incomplete daily tasks
obsidian tasks all todo                     # All incomplete tasks in vault
obsidian tasks file=Recipe done             # Completed tasks in file
obsidian task daily line=3 toggle           # Toggle task completion
obsidian tasks verbose                      # Tasks with file paths + line numbers

# Tags & Properties
obsidian tags all counts                    # All tags with counts
obsidian tag name=project verbose           # Tag details with file list
obsidian properties all counts              # All properties with counts
obsidian property:read name=status file=Note # Read a property
obsidian property:set name=status value=done file=Note # Set a property

# Links & Structure
obsidian backlinks file=Note                # Files linking to Note
obsidian links file=Note                    # Outgoing links from Note
obsidian orphans                            # Files with no incoming links
obsidian deadends                           # Files with no outgoing links
obsidian unresolved                         # Broken links
obsidian outline file=Note                  # Headings tree

# Vault info
obsidian files total                        # File count
obsidian files folder="Work" ext=md         # Filter files
obsidian folders                            # List folders
obsidian folder path="Work" info=size       # Folder info

# Plugins
obsidian plugins                            # List installed
obsidian plugins:enabled                    # List enabled
obsidian plugin:enable id=dataview          # Enable plugin
obsidian plugin:reload id=my-plugin         # Reload (dev)

# Developer
obsidian eval code="app.vault.getFiles().length"  # Run JS
obsidian dev:screenshot path=screenshot.png       # Screenshot
obsidian devtools                                 # Toggle devtools
obsidian dev:console limit=10                     # Recent console msgs
obsidian dev:errors                               # JS errors

# Multi-vault
obsidian vault=Notes daily                  # Target specific vault
obsidian vaults verbose                     # List all vaults with paths
```

## Parameter Syntax

- `param=value` for parameters (quote spaces: `content="Hello world"`)
- Bare words for flags: `obsidian tasks daily todo verbose`
- Multiline: use `\n` for newline, `\t` for tab
- `file=<name>` resolves like wikilinks (name only, no path/extension needed)
- `path=<path>` requires exact path from vault root

## Targeting Vaults

- If CWD is inside a vault, that vault is used
- Otherwise, the active vault is used
- Use `vault=<name>` as FIRST parameter to target a specific vault

## Notes

- CLI connects to running Obsidian via IPC singleton lock
- On Arch Linux, zee.service must have `PrivateTmp=false` for IPC to work
- The wrapper at `~/.local/bin/obsidian` must be in PATH before `/usr/bin/obsidian`
- For non-interactive use (scripts/cron), ensure Obsidian is running first
