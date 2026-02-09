---
description: Edit/read file (vim-style :e)
---

Read and display the contents of the file specified in the argument.

If no file is specified, show the current working directory contents.

Usage:
- `:e path/to/file.ts` - Read and display the file
- `:e .` - List current directory
- `:e src/` - List src directory

This is read-only (like vim's :view). Use the normal edit flow for modifications.
