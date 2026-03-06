---
name: "calibre-cli"
description: "Manage Calibre libraries from the terminal with calibredb and helper scripts. Use when importing/exporting books, auditing metadata quality, fixing title/author swaps, or cleaning non-book files from vault source folders."
---

# Calibre CLI

Use this skill to operate Calibre libraries via CLI, with reproducible
workflows for:

- auditing non-book files and metadata anomalies
- fixing title/author swaps
- cleaning vault source folders before import
- batch import/export with `calibredb`

## Preconditions

- Calibre GUI/server must be closed before write operations.
- `calibredb` must be installed and available on PATH.
- Default library path is read from `~/.config/calibre/global.py.json`.

## Quick Start

```bash
# Inspect library size and sample rows
calibredb --with-library "/path/to/Calibre Library" list | tail -n +2 | wc -l
calibredb --with-library "/path/to/Calibre Library" list --for-machine --fields id,title,authors,formats | sed -n '1,20p'

# Audit metadata quality + non-book candidates
python scripts/audit_calibre_library.py --library "/path/to/Calibre Library"

# Dry-run vault source cleanup
python scripts/clean_source_books.py --vault-root "/path/to/vault"
```

## Workflow

### 1) Audit the Calibre library

Run:

```bash
python scripts/audit_calibre_library.py \
  --library "/path/to/Calibre Library" \
  --out-dir "/path/to/output"
```

Outputs:

- `calibre_nonbook_candidates.tsv`
- `calibre_swap_candidates.tsv`
- `calibre_audit.json`

### 2) Fix swapped metadata

Use `set_metadata` for each ID:

```bash
calibredb --with-library "/path/to/Calibre Library" set_metadata 123 \
  --field "title:Correct Book Title" \
  --field "authors:Correct Author" \
  --field "sort:Book Title, The" \
  --field "author_sort:Lastname, Firstname"
```

### 3) Remove non-book records from Calibre

Use non-permanent removal first:

```bash
calibredb --with-library "/path/to/Calibre Library" remove 12,21,32
```

Only use `--permanent` when explicitly requested.

### 4) Clean source vault folders (non-destructive)

Dry-run:

```bash
python scripts/clean_source_books.py \
  --vault-root "/path/to/vault" \
  --out-dir "/path/to/vault/Study/_System/Documentation"
```

Apply (moves files to archive, no deletion):

```bash
python scripts/clean_source_books.py \
  --vault-root "/path/to/vault" \
  --apply \
  --out-dir "/path/to/vault/Study/_System/Documentation"
```

Archive destination defaults to:
`Study/Library/NonBooks_Archive/From_Books_Sources`.

### 5) Verify

```bash
# Check remaining source file count
find "/path/to/vault/Study/Library/Books" "/path/to/vault/Study/Library/Books 1" -type f \
  \( -iname '*.pdf' -o -iname '*.epub' -o -iname '*.azw3' -o -iname '*.azw' -o -iname '*.mobi' \) | wc -l
```

## References

See [Calibre Commands](references/calibre_commands.md) for common `calibredb`
operations and field names.
