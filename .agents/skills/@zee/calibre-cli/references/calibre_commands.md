# Calibre CLI Commands

## Inspect

```bash
calibredb --with-library "/path/to/Calibre Library" list
calibredb --with-library "/path/to/Calibre Library" list --for-machine --fields id,title,authors,formats
calibredb --with-library "/path/to/Calibre Library" show_metadata 123
```

## Search

```bash
calibredb --with-library "/path/to/Calibre Library" search "title:\"The Global Money Markets\""
calibredb --with-library "/path/to/Calibre Library" search "authors:\"Frank J. Fabozzi\""
```

## Set metadata

```bash
calibredb --with-library "/path/to/Calibre Library" set_metadata 123 \
  --field "title:The Global Money Markets" \
  --field "authors:Frank J. Fabozzi" \
  --field "sort:Global Money Markets, The" \
  --field "author_sort:Fabozzi, Frank J."
```

## Remove records

```bash
# Safe remove (uses Calibre recycle behavior)
calibredb --with-library "/path/to/Calibre Library" remove 12,21,32

# Permanent remove (only when explicitly requested)
calibredb --with-library "/path/to/Calibre Library" remove 12,21,32 --permanent
```

## Export

```bash
calibredb --with-library "/path/to/Calibre Library" export --all \
  --to-dir "/path/to/export" \
  --single-dir \
  --formats EPUB,PDF,AZW3,AZW,MOBI \
  --dont-write-opf \
  --dont-save-cover \
  --dont-save-extra-files
```
