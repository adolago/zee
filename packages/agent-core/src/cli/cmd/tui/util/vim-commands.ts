/**
 * Full vim command handling for the prompt textarea.
 * Supports navigation, operators (d/c/y), text objects, f/F/t/T char search,
 * yank/paste, repeat (.), indent, join, and all standard insert-mode entry keys.
 */

export namespace VimCommands {
  /**
   * Interface that the prompt component implements to give the engine
   * access to cursor position and text manipulation.
   */
  export interface VimCommandContext {
    /** Current cursor offset (character position in the buffer) */
    get cursorOffset(): number
    /** Set cursor offset */
    set cursorOffset(offset: number)
    /** Full plain text of the buffer */
    get text(): string
    /** Set the entire buffer text */
    setText(text: string): void
    /** Insert text at current cursor position */
    insertText(text: string): void
    /** Delete a range [start, end) and return the deleted text */
    deleteRange(start: number, end: number): string
    /** Move cursor to start of buffer */
    gotoBufferStart(): void
    /** Move cursor to end of buffer */
    gotoBufferEnd(): void
    /** Get the line number (0-based) the cursor is on */
    get cursorLine(): number
    /** Get the column (0-based) within the current line */
    get cursorColumn(): number
    /** Get all lines of the buffer */
    get lines(): string[]
    /** Get start offset of a given line number */
    lineStart(line: number): number
    /** Get end offset of a given line number (exclusive of newline) */
    lineEnd(line: number): number
    /** Move cursor up one line */
    moveCursorUp(): void
    /** Move cursor down one line */
    moveCursorDown(): void
  }

  export type VimCommandResult = {
    /** Whether the key was handled */
    handled: boolean
    /** Whether to enter insert mode after handling */
    enterInsert?: boolean
    /** Current pending operator display (e.g., "d", "c", "y") */
    pendingDisplay?: string
  }

  /**
   * The VimEngine holds state across keystrokes: pending operators,
   * character search state, registers, and last change for repeat.
   */
  export class VimEngine {
    private pendingOperator: string | null = null // "d", "c", "y", ">", "<"
    private pendingG = false
    private pendingCharSearch: string | null = null // "f", "F", "t", "T"
    private lastCharSearch: { type: string; char: string } | null = null
    private register = "" // yanked text
    private isLinewise = false // whether register content is linewise
    private lastChange: { keys: string[]; insertedText?: string } | null = null
    private currentChangeKeys: string[] = []
    private recording = false

    /** Reset all pending state (e.g., on Escape) */
    reset(): void {
      this.pendingOperator = null
      this.pendingG = false
      this.pendingCharSearch = null
      this.recording = false
      this.currentChangeKeys = []
    }

    /** Get display string for pending state */
    get pendingDisplay(): string {
      if (this.pendingCharSearch) return this.pendingCharSearch
      if (this.pendingG) return "g"
      if (this.pendingOperator) return this.pendingOperator
      return ""
    }

    /**
     * Process a single key press in normal mode.
     */
    handleKey(ctx: VimCommandContext, key: string): VimCommandResult {
      // 1. Pending character search (f/F/t/T waiting for target char)
      if (this.pendingCharSearch !== null) {
        const searchType = this.pendingCharSearch
        this.pendingCharSearch = null
        if (key.length === 1) {
          this.lastCharSearch = { type: searchType, char: key }
          if (this.pendingOperator) {
            const op = this.pendingOperator
            const range = this.resolveCharSearchRange(ctx, searchType, key)
            if (range) {
              this.recordChange([op, searchType, key])
              this.executeOperator(ctx, op, range[0], range[1])
              this.pendingOperator = null
              if (op === "c") {
                return { handled: true, enterInsert: true }
              }
              return { handled: true }
            }
            this.pendingOperator = null
            return { handled: true }
          }
          this.executeCharSearch(ctx, searchType, key)
          return { handled: true }
        }
        return { handled: true }
      }

      // 2. Pending g (waiting for second g)
      if (this.pendingG) {
        this.pendingG = false
        if (key === "g") {
          if (this.pendingOperator) {
            this.executeOperator(ctx, this.pendingOperator, 0, ctx.cursorOffset)
            this.pendingOperator = null
            return { handled: true }
          }
          ctx.gotoBufferStart()
          return { handled: true }
        }
        // Unknown g-command, reset
        return { handled: true }
      }

      // 3. Pending operator -- waiting for motion or text object
      if (this.pendingOperator !== null) {
        return this.handlePendingOperator(ctx, key)
      }

      // 4. Standalone commands
      return this.handleStandalone(ctx, key)
    }

    private handlePendingOperator(ctx: VimCommandContext, key: string): VimCommandResult {
      const op = this.pendingOperator!

      // Doubled operator: dd, cc, yy, >>, <<
      if (key === op || (op === ">" && key === ">") || (op === "<" && key === "<")) {
        const line = ctx.cursorLine
        const start = ctx.lineStart(line)
        const end = line < ctx.lines.length - 1 ? ctx.lineStart(line + 1) : ctx.lineEnd(line)

        if (op === "d") {
          this.recordChange([op, key])
          const deleted = ctx.deleteRange(start, end)
          this.register = deleted
          this.isLinewise = true
          // Position cursor at start of line
          if (ctx.text.length > 0) {
            const newOffset = Math.min(start, ctx.text.length - 1)
            ctx.cursorOffset = Math.max(0, newOffset)
            this.moveToFirstNonBlank(ctx)
          }
        } else if (op === "c") {
          this.recordChange([op, key])
          const lineText = ctx.lines[line] ?? ""
          const lineEndOffset = ctx.lineEnd(line)
          ctx.deleteRange(start, lineEndOffset)
          this.register = lineText
          this.isLinewise = true
          ctx.cursorOffset = start
          this.pendingOperator = null
          return { handled: true, enterInsert: true }
        } else if (op === "y") {
          const lineText = ctx.lines[line] ?? ""
          this.register = lineText + "\n"
          this.isLinewise = true
        } else if (op === ">") {
          this.recordChange([op, key])
          this.indentLine(ctx, line, "indent")
        } else if (op === "<") {
          this.recordChange([op, key])
          this.indentLine(ctx, line, "dedent")
        }

        this.pendingOperator = null
        return { handled: true }
      }

      // Text objects: i/a + w/W/"/'/(/[/{
      if (key === "i" || key === "a") {
        // Save key and wait for the object character
        const around = key === "a"
        this.pendingOperator = null // will be resolved in the next block
        // We need to wait for the next key, but we consumed the operator.
        // Store the operator+inner/around and re-enter pending state.
        const savedOp = op
        // Return a special "still pending" state -- we need another key
        // Reuse pendingOperator with a tag
        this.pendingOperator = `${savedOp}:${around ? "a" : "i"}`
        return { handled: true, pendingDisplay: `${savedOp}${key}` }
      }

      // Check if we're in "op:i" or "op:a" state (text object second key)
      if (op.includes(":")) {
        const [baseOp, modifier] = op.split(":")
        const around = modifier === "a"
        const range = this.resolveTextObject(ctx, key, around)
        this.pendingOperator = null
        if (range) {
          if (baseOp === "y") {
            this.register = ctx.text.slice(range[0], range[1])
            this.isLinewise = false
          } else {
            this.recordChange([baseOp!, around ? "a" : "i", key])
            this.executeOperator(ctx, baseOp!, range[0], range[1])
            if (baseOp === "c") {
              return { handled: true, enterInsert: true }
            }
          }
        }
        return { handled: true }
      }

      // Motion keys
      const motionRange = this.resolveMotion(ctx, key)
      if (motionRange) {
        if (op === "y") {
          const [start, end] = motionRange
          this.register = ctx.text.slice(start, end)
          this.isLinewise = false
        } else {
          this.recordChange([op, key])
          this.executeOperator(ctx, op, motionRange[0], motionRange[1])
          if (op === "c") {
            this.pendingOperator = null
            return { handled: true, enterInsert: true }
          }
        }
        this.pendingOperator = null
        return { handled: true }
      }

      // g for gg motion within operator
      if (key === "g") {
        this.pendingG = true
        return { handled: true, pendingDisplay: `${op}g` }
      }

      // f/F/t/T within operator
      if (key === "f" || key === "F" || key === "t" || key === "T") {
        this.pendingCharSearch = key
        return { handled: true, pendingDisplay: `${op}${key}` }
      }

      // Unknown motion, cancel operator
      this.pendingOperator = null
      return { handled: true }
    }

    private handleStandalone(ctx: VimCommandContext, key: string): VimCommandResult {
      // Insert mode entry
      switch (key) {
        case "i":
          return { handled: true, enterInsert: true }
        case "I":
          this.moveToFirstNonBlank(ctx)
          return { handled: true, enterInsert: true }
        case "a":
          if (ctx.text.length > 0) {
            ctx.cursorOffset = Math.min(ctx.cursorOffset + 1, ctx.text.length)
          }
          return { handled: true, enterInsert: true }
        case "A":
          ctx.cursorOffset = ctx.lineEnd(ctx.cursorLine)
          return { handled: true, enterInsert: true }
        case "o":
          this.recordChange(["o"])
          this.openLineBelow(ctx)
          return { handled: true, enterInsert: true }
        case "O":
          this.recordChange(["O"])
          this.openLineAbove(ctx)
          return { handled: true, enterInsert: true }
      }

      // Navigation
      switch (key) {
        case "h":
          ctx.cursorOffset = Math.max(0, ctx.cursorOffset - 1)
          return { handled: true }
        case "l":
          ctx.cursorOffset = Math.min(ctx.text.length, ctx.cursorOffset + 1)
          return { handled: true }
        case "j":
          ctx.moveCursorDown()
          return { handled: true }
        case "k":
          ctx.moveCursorUp()
          return { handled: true }
        case "w":
          ctx.cursorOffset = this.findNextWordStart(ctx.text, ctx.cursorOffset)
          return { handled: true }
        case "W":
          ctx.cursorOffset = this.findNextWORDStart(ctx.text, ctx.cursorOffset)
          return { handled: true }
        case "e":
          ctx.cursorOffset = this.findWordEnd(ctx.text, ctx.cursorOffset)
          return { handled: true }
        case "E":
          ctx.cursorOffset = this.findWORDEnd(ctx.text, ctx.cursorOffset)
          return { handled: true }
        case "b":
          ctx.cursorOffset = this.findPrevWordStart(ctx.text, ctx.cursorOffset)
          return { handled: true }
        case "B":
          ctx.cursorOffset = this.findPrevWORDStart(ctx.text, ctx.cursorOffset)
          return { handled: true }
        case "0":
          ctx.cursorOffset = ctx.lineStart(ctx.cursorLine)
          return { handled: true }
        case "$":
          ctx.cursorOffset = ctx.lineEnd(ctx.cursorLine)
          return { handled: true }
        case "^":
          this.moveToFirstNonBlank(ctx)
          return { handled: true }
        case "{":
          ctx.cursorOffset = this.findPrevParagraphStart(ctx)
          return { handled: true }
        case "}":
          ctx.cursorOffset = this.findNextParagraphStart(ctx)
          return { handled: true }
        case "G":
          ctx.gotoBufferEnd()
          return { handled: true }
      }

      // g prefix
      if (key === "g") {
        this.pendingG = true
        return { handled: true, pendingDisplay: "g" }
      }

      // Character search
      if (key === "f" || key === "F" || key === "t" || key === "T") {
        this.pendingCharSearch = key
        return { handled: true, pendingDisplay: key }
      }

      // Search repeat
      if (key === ";") {
        if (this.lastCharSearch) {
          this.executeCharSearch(ctx, this.lastCharSearch.type, this.lastCharSearch.char)
        }
        return { handled: true }
      }
      if (key === ",") {
        if (this.lastCharSearch) {
          const reversed = this.reverseCharSearchType(this.lastCharSearch.type)
          this.executeCharSearch(ctx, reversed, this.lastCharSearch.char)
        }
        return { handled: true }
      }

      // Operators
      if (key === "d" || key === "c" || key === "y") {
        this.pendingOperator = key
        return { handled: true, pendingDisplay: key }
      }

      // D = d$
      if (key === "D") {
        this.recordChange(["D"])
        const start = ctx.cursorOffset
        const end = ctx.lineEnd(ctx.cursorLine)
        const deleted = ctx.deleteRange(start, end)
        this.register = deleted
        this.isLinewise = false
        if (ctx.cursorOffset > 0 && ctx.cursorOffset >= ctx.text.length) {
          ctx.cursorOffset = ctx.text.length - 1
        }
        return { handled: true }
      }

      // C = c$
      if (key === "C") {
        this.recordChange(["C"])
        const start = ctx.cursorOffset
        const end = ctx.lineEnd(ctx.cursorLine)
        this.register = ctx.text.slice(start, end)
        this.isLinewise = false
        ctx.deleteRange(start, end)
        return { handled: true, enterInsert: true }
      }

      // Y = yy (yank line)
      if (key === "Y") {
        const line = ctx.cursorLine
        const lineText = ctx.lines[line] ?? ""
        this.register = lineText + "\n"
        this.isLinewise = true
        return { handled: true }
      }

      // x = delete char at cursor
      if (key === "x") {
        this.recordChange(["x"])
        if (ctx.text.length > 0 && ctx.cursorOffset < ctx.text.length) {
          this.register = ctx.text[ctx.cursorOffset] ?? ""
          this.isLinewise = false
          ctx.deleteRange(ctx.cursorOffset, ctx.cursorOffset + 1)
          if (ctx.cursorOffset >= ctx.text.length && ctx.cursorOffset > 0) {
            ctx.cursorOffset = ctx.text.length - 1
          }
        }
        return { handled: true }
      }

      // Paste
      if (key === "p") {
        this.executePaste(ctx, "after")
        return { handled: true }
      }
      if (key === "P") {
        this.executePaste(ctx, "before")
        return { handled: true }
      }

      // Repeat
      if (key === ".") {
        this.executeRepeat(ctx)
        return { handled: true }
      }

      // Indent/dedent (first > or <, sets pending)
      if (key === ">" || key === "<") {
        this.pendingOperator = key
        return { handled: true, pendingDisplay: key }
      }

      // Join
      if (key === "J") {
        this.recordChange(["J"])
        this.joinLines(ctx)
        return { handled: true }
      }

      return { handled: false }
    }

    // -- Motion resolution (returns [start, end] range from current cursor) --

    private resolveMotion(ctx: VimCommandContext, key: string): [number, number] | null {
      const cursor = ctx.cursorOffset
      switch (key) {
        case "w":
          return [cursor, this.findNextWordStart(ctx.text, cursor)]
        case "W":
          return [cursor, this.findNextWORDStart(ctx.text, cursor)]
        case "e":
          return [cursor, this.findWordEnd(ctx.text, cursor) + 1]
        case "E":
          return [cursor, this.findWORDEnd(ctx.text, cursor) + 1]
        case "b":
          return [this.findPrevWordStart(ctx.text, cursor), cursor]
        case "B":
          return [this.findPrevWORDStart(ctx.text, cursor), cursor]
        case "0":
          return [ctx.lineStart(ctx.cursorLine), cursor]
        case "$":
          return [cursor, ctx.lineEnd(ctx.cursorLine)]
        case "^": {
          const line = ctx.cursorLine
          const start = ctx.lineStart(line)
          const lineText = ctx.lines[line] ?? ""
          const firstNonBlank = start + (lineText.length - lineText.trimStart().length)
          return [Math.min(firstNonBlank, cursor), Math.max(firstNonBlank, cursor)]
        }
        case "{": {
          const target = this.findPrevParagraphStart(ctx)
          return [target, cursor]
        }
        case "}": {
          const target = this.findNextParagraphStart(ctx)
          return [cursor, target]
        }
        case "h":
          return [Math.max(0, cursor - 1), cursor]
        case "l":
          return [cursor, Math.min(ctx.text.length, cursor + 1)]
        case "G":
          return [cursor, ctx.text.length]
        default:
          return null
      }
    }

    private resolveCharSearchRange(ctx: VimCommandContext, type: string, char: string): [number, number] | null {
      const cursor = ctx.cursorOffset
      const text = ctx.text

      if (type === "f") {
        const idx = text.indexOf(char, cursor + 1)
        if (idx === -1) return null
        return [cursor, idx + 1]
      }
      if (type === "F") {
        const idx = text.lastIndexOf(char, cursor - 1)
        if (idx === -1) return null
        return [idx, cursor]
      }
      if (type === "t") {
        const idx = text.indexOf(char, cursor + 1)
        if (idx === -1) return null
        return [cursor, idx]
      }
      if (type === "T") {
        const idx = text.lastIndexOf(char, cursor - 1)
        if (idx === -1) return null
        return [idx + 1, cursor]
      }
      return null
    }

    // -- Text object resolution --

    private resolveTextObject(ctx: VimCommandContext, key: string, around: boolean): [number, number] | null {
      const cursor = ctx.cursorOffset
      const text = ctx.text

      switch (key) {
        case "w":
          return this.textObjectWord(text, cursor, around, false)
        case "W":
          return this.textObjectWord(text, cursor, around, true)
        case '"':
          return this.textObjectQuote(text, cursor, around, '"')
        case "'":
          return this.textObjectQuote(text, cursor, around, "'")
        case "`":
          return this.textObjectQuote(text, cursor, around, "`")
        case "(":
        case ")":
          return this.textObjectBracket(text, cursor, around, "(", ")")
        case "[":
        case "]":
          return this.textObjectBracket(text, cursor, around, "[", "]")
        case "{":
        case "}":
          return this.textObjectBracket(text, cursor, around, "{", "}")
        default:
          return null
      }
    }

    private textObjectWord(text: string, cursor: number, around: boolean, bigWord: boolean): [number, number] | null {
      const isWordChar = bigWord ? (c: string) => c !== " " && c !== "\t" && c !== "\n" : (c: string) => /\w/.test(c)

      // Find word boundaries around cursor
      let start = cursor
      let end = cursor

      // Extend backward to find word start
      while (start > 0 && isWordChar(text[start - 1]!)) start--
      // Extend forward to find word end
      while (end < text.length && isWordChar(text[end]!)) end++

      if (start === end) {
        // Cursor is on whitespace, select whitespace block
        while (start > 0 && !isWordChar(text[start - 1]!) && text[start - 1] !== "\n") start--
        while (end < text.length && !isWordChar(text[end]!) && text[end] !== "\n") end++
        return start < end ? [start, end] : null
      }

      if (around) {
        // Include trailing whitespace, or leading if no trailing
        const origEnd = end
        while (end < text.length && (text[end] === " " || text[end] === "\t")) end++
        if (end === origEnd) {
          // No trailing whitespace, include leading
          while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start--
        }
      }

      return [start, end]
    }

    private textObjectQuote(text: string, cursor: number, around: boolean, quote: string): [number, number] | null {
      // Find quote pair surrounding cursor
      // Search backward for opening quote
      let open = -1
      for (let i = cursor; i >= 0; i--) {
        if (text[i] === quote) {
          open = i
          break
        }
      }
      if (open === -1) return null

      // Search forward for closing quote
      let close = -1
      const searchStart = open === cursor ? cursor + 1 : cursor
      for (let i = searchStart; i < text.length; i++) {
        if (text[i] === quote && i !== open) {
          close = i
          break
        }
      }
      if (close === -1) return null

      if (around) {
        return [open, close + 1]
      }
      return [open + 1, close]
    }

    private textObjectBracket(
      text: string,
      cursor: number,
      around: boolean,
      openChar: string,
      closeChar: string,
    ): [number, number] | null {
      // Find matching bracket pair
      let open = -1
      let depth = 0

      // Search backward for opening bracket
      for (let i = cursor; i >= 0; i--) {
        if (text[i] === closeChar && i !== cursor) depth++
        if (text[i] === openChar) {
          if (depth === 0) {
            open = i
            break
          }
          depth--
        }
      }
      if (open === -1) return null

      // Search forward for closing bracket
      let close = -1
      depth = 0
      for (let i = open + 1; i < text.length; i++) {
        if (text[i] === openChar) depth++
        if (text[i] === closeChar) {
          if (depth === 0) {
            close = i
            break
          }
          depth--
        }
      }
      if (close === -1) return null

      if (around) {
        return [open, close + 1]
      }
      return [open + 1, close]
    }

    // -- Operator execution --

    private executeOperator(ctx: VimCommandContext, op: string, start: number, end: number): void {
      if (start > end) [start, end] = [end, start]
      if (start === end) return

      if (op === "d") {
        const deleted = ctx.deleteRange(start, end)
        this.register = deleted
        this.isLinewise = false
        ctx.cursorOffset = Math.min(start, Math.max(0, ctx.text.length - 1))
      } else if (op === "c") {
        const deleted = ctx.deleteRange(start, end)
        this.register = deleted
        this.isLinewise = false
        ctx.cursorOffset = start
      } else if (op === "y") {
        this.register = ctx.text.slice(start, end)
        this.isLinewise = false
      }
    }

    // -- Character search execution --

    private executeCharSearch(ctx: VimCommandContext, type: string, char: string): void {
      const cursor = ctx.cursorOffset
      const text = ctx.text

      if (type === "f") {
        const idx = text.indexOf(char, cursor + 1)
        if (idx !== -1) ctx.cursorOffset = idx
      } else if (type === "F") {
        const idx = text.lastIndexOf(char, cursor - 1)
        if (idx !== -1) ctx.cursorOffset = idx
      } else if (type === "t") {
        const idx = text.indexOf(char, cursor + 1)
        if (idx !== -1) ctx.cursorOffset = idx - 1
      } else if (type === "T") {
        const idx = text.lastIndexOf(char, cursor - 1)
        if (idx !== -1) ctx.cursorOffset = idx + 1
      }
    }

    private reverseCharSearchType(type: string): string {
      switch (type) {
        case "f":
          return "F"
        case "F":
          return "f"
        case "t":
          return "T"
        case "T":
          return "t"
        default:
          return type
      }
    }

    // -- Word navigation helpers --

    private findNextWordStart(text: string, offset: number): number {
      let i = offset
      const len = text.length
      if (i >= len) return len

      // Skip current word characters
      if (/\w/.test(text[i] ?? "")) {
        while (i < len && /\w/.test(text[i] ?? "")) i++
      } else if (!/\s/.test(text[i] ?? "")) {
        // Skip punctuation
        while (i < len && !/\w/.test(text[i] ?? "") && !/\s/.test(text[i] ?? "")) i++
      }

      // Skip whitespace
      while (i < len && /\s/.test(text[i] ?? "")) i++

      return Math.min(i, len)
    }

    private findWordEnd(text: string, offset: number): number {
      let i = offset + 1
      const len = text.length
      if (i >= len) return Math.max(0, len - 1)

      // Skip whitespace
      while (i < len && /\s/.test(text[i] ?? "")) i++

      // Skip word or punctuation
      if (/\w/.test(text[i] ?? "")) {
        while (i < len && /\w/.test(text[i] ?? "")) i++
      } else {
        while (i < len && !/\w/.test(text[i] ?? "") && !/\s/.test(text[i] ?? "")) i++
      }

      return Math.max(offset, i - 1)
    }

    private findPrevWordStart(text: string, offset: number): number {
      let i = offset - 1
      if (i <= 0) return 0

      // Skip whitespace
      while (i > 0 && /\s/.test(text[i] ?? "")) i--

      // Skip word or punctuation
      if (/\w/.test(text[i] ?? "")) {
        while (i > 0 && /\w/.test(text[i - 1] ?? "")) i--
      } else {
        while (i > 0 && !/\w/.test(text[i - 1] ?? "") && !/\s/.test(text[i - 1] ?? "")) i--
      }

      return Math.max(0, i)
    }

    private isWhitespace(char: string | undefined): boolean {
      return char === undefined ? true : /\s/.test(char)
    }

    private findNextWORDStart(text: string, offset: number): number {
      let i = offset
      const len = text.length
      if (i >= len) return len

      if (!this.isWhitespace(text[i])) {
        while (i < len && !this.isWhitespace(text[i])) i++
      }

      while (i < len && this.isWhitespace(text[i])) i++

      return Math.min(i, len)
    }

    private findWORDEnd(text: string, offset: number): number {
      let i = offset
      const len = text.length
      if (i >= len) return Math.max(0, len - 1)

      while (i < len && this.isWhitespace(text[i])) i++
      while (i < len && !this.isWhitespace(text[i])) i++

      return Math.max(offset, i - 1)
    }

    private findPrevWORDStart(text: string, offset: number): number {
      let i = offset - 1
      if (i <= 0) return 0

      while (i > 0 && this.isWhitespace(text[i])) i--
      while (i > 0 && !this.isWhitespace(text[i - 1])) i--

      return Math.max(0, i)
    }

    private findCurrentParagraphStartLine(ctx: VimCommandContext): number {
      const lines = ctx.lines
      let line = ctx.cursorLine

      if (line >= lines.length) return lines.length - 1

      while (line >= 0 && (lines[line]?.trim() ?? "") === "") line--
      if (line < 0) return 0

      while (line > 0 && (lines[line - 1]?.trim() ?? "") !== "") line--

      return line
    }

    private findPrevParagraphStart(ctx: VimCommandContext): number {
      const lines = ctx.lines
      const currentStartLine = this.findCurrentParagraphStartLine(ctx)
      const currentStartOffset = ctx.lineStart(currentStartLine)

      if (ctx.cursorOffset > currentStartOffset) {
        return currentStartOffset
      }

      let line = currentStartLine - 1
      while (line >= 0 && (lines[line]?.trim() ?? "") === "") line--
      if (line < 0) return 0

      while (line > 0 && (lines[line - 1]?.trim() ?? "") !== "") line--

      return ctx.lineStart(line)
    }

    private findNextParagraphStart(ctx: VimCommandContext): number {
      const lines = ctx.lines
      let line = ctx.cursorLine

      if (line >= lines.length) return ctx.text.length

      while (line < lines.length && (lines[line]?.trim() ?? "") !== "") line++
      while (line < lines.length && (lines[line]?.trim() ?? "") === "") line++

      if (line >= lines.length) return ctx.text.length
      return ctx.lineStart(line)
    }

    // -- Line helpers --

    private moveToFirstNonBlank(ctx: VimCommandContext): void {
      const line = ctx.cursorLine
      const start = ctx.lineStart(line)
      const lineText = ctx.lines[line] ?? ""
      const trimmed = lineText.trimStart()
      const nonBlankOffset = start + (lineText.length - trimmed.length)
      ctx.cursorOffset = nonBlankOffset
    }

    private openLineBelow(ctx: VimCommandContext): void {
      const line = ctx.cursorLine
      const end = ctx.lineEnd(line)
      const text = ctx.text
      const before = text.slice(0, end)
      const after = text.slice(end)
      ctx.setText(before + "\n" + after)
      ctx.cursorOffset = end + 1
    }

    private openLineAbove(ctx: VimCommandContext): void {
      const line = ctx.cursorLine
      const start = ctx.lineStart(line)
      const text = ctx.text
      const before = text.slice(0, start)
      const after = text.slice(start)
      ctx.setText(before + "\n" + after)
      ctx.cursorOffset = start
    }

    private indentLine(ctx: VimCommandContext, line: number, direction: "indent" | "dedent"): void {
      const lines = ctx.lines
      const lineText = lines[line] ?? ""
      let newLine: string

      if (direction === "indent") {
        newLine = "  " + lineText
      } else {
        // Remove up to 2 leading spaces or 1 tab
        if (lineText.startsWith("\t")) {
          newLine = lineText.slice(1)
        } else if (lineText.startsWith("  ")) {
          newLine = lineText.slice(2)
        } else if (lineText.startsWith(" ")) {
          newLine = lineText.slice(1)
        } else {
          newLine = lineText
        }
      }

      lines[line] = newLine
      ctx.setText(lines.join("\n"))
      this.moveToFirstNonBlank(ctx)
    }

    private joinLines(ctx: VimCommandContext): void {
      const line = ctx.cursorLine
      const lines = ctx.lines
      if (line >= lines.length - 1) return

      const currentLine = lines[line] ?? ""
      const nextLine = (lines[line + 1] ?? "").trimStart()
      const joined = currentLine + (nextLine ? " " + nextLine : "")
      const joinPoint = currentLine.length

      lines.splice(line, 2, joined)
      ctx.setText(lines.join("\n"))
      ctx.cursorOffset = ctx.lineStart(line) + joinPoint
    }

    // -- Paste --

    private executePaste(ctx: VimCommandContext, position: "after" | "before"): void {
      if (!this.register) return

      if (this.isLinewise) {
        const line = ctx.cursorLine
        if (position === "after") {
          const end = ctx.lineEnd(line)
          const text = ctx.text
          const before = text.slice(0, end)
          const after = text.slice(end)
          const insertText = "\n" + this.register.replace(/\n$/, "")
          ctx.setText(before + insertText + after)
          ctx.cursorOffset = end + 1
        } else {
          const start = ctx.lineStart(line)
          const text = ctx.text
          const before = text.slice(0, start)
          const after = text.slice(start)
          const insertText = this.register.replace(/\n$/, "") + "\n"
          ctx.setText(before + insertText + after)
          ctx.cursorOffset = start
        }
        this.moveToFirstNonBlank(ctx)
      } else {
        if (position === "after") {
          const offset = Math.min(ctx.cursorOffset + 1, ctx.text.length)
          const before = ctx.text.slice(0, offset)
          const after = ctx.text.slice(offset)
          ctx.setText(before + this.register + after)
          ctx.cursorOffset = offset + this.register.length - 1
        } else {
          const offset = ctx.cursorOffset
          const before = ctx.text.slice(0, offset)
          const after = ctx.text.slice(offset)
          ctx.setText(before + this.register + after)
          ctx.cursorOffset = offset + this.register.length - 1
        }
      }
    }

    // -- Change recording & repeat --

    private recordChange(keys: string[]): void {
      this.lastChange = { keys: [...keys] }
    }

    private executeRepeat(ctx: VimCommandContext): void {
      if (!this.lastChange) return

      // Replay the key sequence
      for (const key of this.lastChange.keys) {
        this.handleKey(ctx, key)
      }
    }
  }
}
