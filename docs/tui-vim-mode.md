# TUI Vim Mode Manual

This document describes the Vim-style keybindings available in the zee TUI prompt.

## Enable or disable Vim mode

Vim mode is enabled by default. Configure it in your config file:

```json
{
  "tui": {
    "vim": {
      "enabled": true,
      "start_in_insert": true
    }
  }
}
```

## Modes and indicators

- Normal mode shows `N` in the status bar.
- Insert mode shows `I`.
- A pending operator shows next to `N` (for example `N d`).
- HOLD/RELEASE is shown next to the mode indicator to reflect session mode.
- Zee starts in insert mode by default so ordinary typing works immediately. Press `Esc` to enter normal mode.

## Insert mode entry (Normal mode)

- `i` insert at cursor
- `I` insert at first non-blank on the line
- `a` append after cursor
- `A` append at end of line
- `o` open line below
- `O` open line above

## Navigation (Normal mode)

Character/line:
- `h` left, `j` down, `k` up, `l` right
- `0` line start
- `^` first non-blank
- `$` line end
- `gg` buffer start
- `G` buffer end

Word motions:
- `w` next word start
- `e` word end
- `b` previous word start
- `W` next WORD start (whitespace-delimited)
- `E` WORD end (whitespace-delimited)
- `B` previous WORD start (whitespace-delimited)

Paragraph motions:
- `{` previous paragraph start
- `}` next paragraph start

Character search:
- `f{char}` find forward to char
- `F{char}` find backward to char
- `t{char}` to before char
- `T{char}` to after char (backward)
- `;` repeat last f/F/t/T
- `,` reverse last f/F/t/T

## Operators

Operators apply to motions or text objects:

- `d` delete
- `c` change (delete then enter insert)
- `y` yank
- `>` indent
- `<` dedent

Examples:
- `dw`, `dW`, `d{`, `d}` delete by motion
- `dd`, `cc`, `yy`, `>>`, `<<` operate on the whole line
- `D` delete to end of line
- `C` change to end of line
- `Y` yank line

## Text objects

Use `i` (inner) or `a` (around) with:

- `w` or `W` word / WORD
- `"`, `'`, `` ` `` quotes
- `(` `)` brackets
- `[` `]` brackets
- `{` `}` brackets

Examples:
- `diw` delete inner word
- `daw` delete around word (includes whitespace)
- `ci"` change inside quotes
- `da(` delete around parentheses

## Other edit commands

- `x` delete char at cursor
- `p` paste after cursor
- `P` paste before cursor
- `J` join line with next
- `.` repeat last change

## Not supported yet

- Visual mode
- Counts (like `3w`)
- Search with `/` and `?`
- Marks and macros

If you want any of these, open a request and we can prioritize them.
