import { describe, test, expect, beforeEach } from "bun:test"
import { VimCommands } from "../src/cli/cmd/tui/util/vim-commands"

/**
 * Tests for vim mode state transitions.
 *
 * The VimProvider in @tui/context/vim.tsx manages vim-style modal editing.
 * Since it relies on Solid.js reactivity and context providers, we test
 * the core state machine logic directly by simulating the provider's behavior.
 */

type VimMode = "normal" | "insert"

interface VimConfig {
  enabled?: boolean
  start_in_insert?: boolean
}

/**
 * Creates a vim mode state machine that mirrors the VimProvider implementation.
 * This allows us to test the state transitions without the full TUI context.
 */
function createVimState(config: VimConfig = {}) {
  const enabled = config.enabled !== false
  const startInInsert = config.start_in_insert !== false

  let mode: VimMode = startInInsert ? "insert" : "normal"
  let focusCallbackInvoked = false
  let focusCallback: (() => void) | null = null

  return {
    get enabled() {
      return enabled
    },
    get mode(): VimMode {
      return enabled ? mode : "insert"
    },
    get isNormal() {
      return enabled && mode === "normal"
    },
    get isInsert() {
      return !enabled || mode === "insert"
    },
    setMode(newMode: VimMode) {
      if (!enabled) return
      mode = newMode
    },
    enterNormal() {
      if (!enabled) return
      mode = "normal"
    },
    enterInsert() {
      mode = "insert"
      focusCallback?.()
    },
    registerFocusCallback(fn: () => void) {
      focusCallback = fn
    },
    // Test helpers
    get _internalMode() {
      return mode
    },
    get _focusCallbackInvoked() {
      return focusCallbackInvoked
    },
    _resetFocusTracking() {
      focusCallbackInvoked = false
    },
  }
}

describe("Vim mode state machine", () => {
  describe("initial state", () => {
    test("initial mode is 'normal' when start_in_insert is false", () => {
      const vim = createVimState({ enabled: true, start_in_insert: false })
      expect(vim.mode).toBe("normal")
      expect(vim.isNormal).toBe(true)
      expect(vim.isInsert).toBe(false)
    })

    test("initial mode is 'insert' when start_in_insert is undefined (default)", () => {
      const vim = createVimState({ enabled: true })
      expect(vim.mode).toBe("insert")
      expect(vim.isNormal).toBe(false)
      expect(vim.isInsert).toBe(true)
    })

    test("initial mode is 'insert' when start_in_insert is true", () => {
      const vim = createVimState({ enabled: true, start_in_insert: true })
      expect(vim.mode).toBe("insert")
      expect(vim.isNormal).toBe(false)
      expect(vim.isInsert).toBe(true)
    })
  })

  describe("mode transitions", () => {
    let vim: ReturnType<typeof createVimState>

    beforeEach(() => {
      vim = createVimState({ enabled: true, start_in_insert: false })
    })

    test("enterNormal() switches from insert to normal", () => {
      vim.enterInsert()
      expect(vim.mode).toBe("insert")

      vim.enterNormal()
      expect(vim.mode).toBe("normal")
      expect(vim.isNormal).toBe(true)
      expect(vim.isInsert).toBe(false)
    })

    test("enterInsert() switches from normal to insert", () => {
      expect(vim.mode).toBe("normal")

      vim.enterInsert()
      expect(vim.mode).toBe("insert")
      expect(vim.isNormal).toBe(false)
      expect(vim.isInsert).toBe(true)
    })

    test("enterInsert() triggers the focus callback", () => {
      let callbackInvoked = false
      vim.registerFocusCallback(() => {
        callbackInvoked = true
      })

      expect(callbackInvoked).toBe(false)
      vim.enterInsert()
      expect(callbackInvoked).toBe(true)
    })

    test("enterInsert() does not throw when no callback is registered", () => {
      expect(() => vim.enterInsert()).not.toThrow()
    })

    test("setMode() works for switching to normal", () => {
      vim.enterInsert()
      expect(vim.mode).toBe("insert")

      vim.setMode("normal")
      expect(vim.mode).toBe("normal")
    })

    test("setMode() works for switching to insert", () => {
      expect(vim.mode).toBe("normal")

      vim.setMode("insert")
      expect(vim.mode).toBe("insert")
    })

    test("multiple mode transitions work correctly", () => {
      expect(vim.mode).toBe("normal")

      vim.enterInsert()
      expect(vim.mode).toBe("insert")

      vim.enterNormal()
      expect(vim.mode).toBe("normal")

      vim.setMode("insert")
      expect(vim.mode).toBe("insert")

      vim.setMode("normal")
      expect(vim.mode).toBe("normal")
    })
  })

  describe("disabled vim mode", () => {
    let vim: ReturnType<typeof createVimState>

    beforeEach(() => {
      vim = createVimState({ enabled: false })
    })

    test("mode always returns 'insert' when disabled", () => {
      expect(vim.mode).toBe("insert")
    })

    test("isNormal is always false when disabled", () => {
      expect(vim.isNormal).toBe(false)
    })

    test("isInsert is always true when disabled", () => {
      expect(vim.isInsert).toBe(true)
    })

    test("enterNormal() is a no-op when disabled", () => {
      vim.enterNormal()
      expect(vim.mode).toBe("insert")
      expect(vim.isNormal).toBe(false)
      expect(vim._internalMode).toBe("insert") // internal state unchanged by enterNormal when disabled
    })

    test("setMode() is a no-op when disabled", () => {
      // Internal mode starts as insert (since start_in_insert defaults to true)
      expect(vim._internalMode).toBe("insert")

      vim.setMode("insert")
      // setMode should be a no-op, so internal mode stays the same
      expect(vim._internalMode).toBe("insert")
      // But the external mode always reports insert
      expect(vim.mode).toBe("insert")

      vim.setMode("normal")
      expect(vim._internalMode).toBe("insert")
      expect(vim.mode).toBe("insert")
    })

    test("enterInsert() still changes internal state when disabled", () => {
      // Note: enterInsert() does NOT check enabled, matching the actual implementation
      // This allows focus callback to still work even when vim mode is disabled
      vim.enterNormal() // This is a no-op when disabled
      expect(vim._internalMode).toBe("insert")

      vim.enterInsert() // This changes internal mode to insert
      expect(vim._internalMode).toBe("insert")
      expect(vim.mode).toBe("insert") // Always insert when disabled
    })

    test("focus callback is triggered by enterInsert() even when disabled", () => {
      let callbackInvoked = false
      vim.registerFocusCallback(() => {
        callbackInvoked = true
      })

      vim.enterInsert()
      expect(callbackInvoked).toBe(true)
    })
  })

  describe("default configuration", () => {
    test("enabled defaults to true when not specified", () => {
      const vim = createVimState({})
      expect(vim.enabled).toBe(true)
    })

    test("start_in_insert defaults to true when not specified", () => {
      const vim = createVimState({})
      expect(vim.mode).toBe("insert")
    })

    test("empty config results in vim enabled, starting in insert mode", () => {
      const vim = createVimState({})
      expect(vim.enabled).toBe(true)
      expect(vim.mode).toBe("insert")
      expect(vim.isNormal).toBe(false)
      expect(vim.isInsert).toBe(true)
    })
  })

  describe("edge cases", () => {
    test("calling enterNormal() when already in normal mode is idempotent", () => {
      const vim = createVimState({ enabled: true, start_in_insert: false })
      expect(vim.mode).toBe("normal")

      vim.enterNormal()
      expect(vim.mode).toBe("normal")

      vim.enterNormal()
      expect(vim.mode).toBe("normal")
    })

    test("calling enterInsert() when already in insert mode is idempotent", () => {
      const vim = createVimState({ enabled: true, start_in_insert: true })
      expect(vim.mode).toBe("insert")

      vim.enterInsert()
      expect(vim.mode).toBe("insert")

      vim.enterInsert()
      expect(vim.mode).toBe("insert")
    })

    test("focus callback is invoked each time enterInsert() is called", () => {
      const vim = createVimState({ enabled: true, start_in_insert: true })
      let callbackCount = 0
      vim.registerFocusCallback(() => {
        callbackCount++
      })

      vim.enterInsert()
      expect(callbackCount).toBe(1)

      vim.enterInsert()
      expect(callbackCount).toBe(2)

      vim.enterInsert()
      expect(callbackCount).toBe(3)
    })

    test("replacing focus callback works correctly", () => {
      const vim = createVimState({ enabled: true })
      let firstCalled = false
      let secondCalled = false

      vim.registerFocusCallback(() => {
        firstCalled = true
      })
      vim.enterInsert()
      expect(firstCalled).toBe(true)
      expect(secondCalled).toBe(false)

      vim.registerFocusCallback(() => {
        secondCalled = true
      })
      vim.enterInsert()
      expect(secondCalled).toBe(true)
    })

    test("setMode with same mode is idempotent", () => {
      const vim = createVimState({ enabled: true, start_in_insert: false })
      expect(vim.mode).toBe("normal")

      vim.setMode("normal")
      expect(vim.mode).toBe("normal")

      vim.setMode("insert")
      expect(vim.mode).toBe("insert")

      vim.setMode("insert")
      expect(vim.mode).toBe("insert")
    })
  })

  describe("config combinations", () => {
    test("enabled: false, start_in_insert: true", () => {
      const vim = createVimState({ enabled: false, start_in_insert: true })
      expect(vim.enabled).toBe(false)
      // Internal mode starts as insert due to config
      expect(vim._internalMode).toBe("insert")
      // External mode always reports insert when disabled
      expect(vim.mode).toBe("insert")
      expect(vim.isNormal).toBe(false)
      expect(vim.isInsert).toBe(true)
    })

    test("enabled: false, start_in_insert: false", () => {
      const vim = createVimState({ enabled: false, start_in_insert: false })
      expect(vim.enabled).toBe(false)
      // Internal mode starts as normal
      expect(vim._internalMode).toBe("normal")
      // But external mode always reports insert when disabled
      expect(vim.mode).toBe("insert")
      expect(vim.isNormal).toBe(false)
      expect(vim.isInsert).toBe(true)
    })
  })
})

// -- VimEngine tests --

/** Creates a mock VimCommandContext backed by a simple string buffer */
function createMockContext(initialText = "", initialCursor = 0): VimCommands.VimCommandContext {
  let text = initialText
  let cursor = initialCursor

  return {
    get cursorOffset() {
      return cursor
    },
    set cursorOffset(offset: number) {
      cursor = Math.max(0, Math.min(offset, text.length))
    },
    get text() {
      return text
    },
    setText(t: string) {
      text = t
    },
    insertText(t: string) {
      text = text.slice(0, cursor) + t + text.slice(cursor)
      cursor += t.length
    },
    deleteRange(start: number, end: number): string {
      const deleted = text.slice(start, end)
      text = text.slice(0, start) + text.slice(end)
      return deleted
    },
    gotoBufferStart() {
      cursor = 0
    },
    gotoBufferEnd() {
      cursor = text.length
    },
    get cursorLine(): number {
      const before = text.slice(0, cursor)
      return (before.match(/\n/g) ?? []).length
    },
    get cursorColumn(): number {
      const before = text.slice(0, cursor)
      const lastNewline = before.lastIndexOf("\n")
      return lastNewline === -1 ? cursor : cursor - lastNewline - 1
    },
    get lines(): string[] {
      return text.split("\n")
    },
    lineStart(line: number): number {
      const lines = text.split("\n")
      let offset = 0
      for (let i = 0; i < line && i < lines.length; i++) {
        offset += lines[i]!.length + 1
      }
      return offset
    },
    lineEnd(line: number): number {
      const lines = text.split("\n")
      let offset = 0
      for (let i = 0; i <= line && i < lines.length; i++) {
        if (i === line) return offset + lines[i]!.length
        offset += lines[i]!.length + 1
      }
      return offset
    },
    moveCursorUp() {
      const col = this.cursorColumn
      const line = this.cursorLine
      if (line > 0) {
        const start = this.lineStart(line - 1)
        const prevLineLen = this.lines[line - 1]?.length ?? 0
        cursor = start + Math.min(col, prevLineLen)
      }
    },
    moveCursorDown() {
      const col = this.cursorColumn
      const line = this.cursorLine
      const lines = this.lines
      if (line < lines.length - 1) {
        const start = this.lineStart(line + 1)
        const nextLineLen = lines[line + 1]?.length ?? 0
        cursor = start + Math.min(col, nextLineLen)
      }
    },
  }
}

describe("VimEngine", () => {
  let engine: VimCommands.VimEngine

  beforeEach(() => {
    engine = new VimCommands.VimEngine()
  })

  describe("insert mode entry", () => {
    test("i enters insert mode", () => {
      const ctx = createMockContext("hello")
      const result = engine.handleKey(ctx, "i")
      expect(result.handled).toBe(true)
      expect(result.enterInsert).toBe(true)
    })

    test("I moves to first non-blank and enters insert", () => {
      const ctx = createMockContext("  hello", 5)
      const result = engine.handleKey(ctx, "I")
      expect(result.enterInsert).toBe(true)
      expect(ctx.cursorOffset).toBe(2) // after the two spaces
    })

    test("a moves cursor right and enters insert", () => {
      const ctx = createMockContext("hello", 2)
      const result = engine.handleKey(ctx, "a")
      expect(result.enterInsert).toBe(true)
      expect(ctx.cursorOffset).toBe(3)
    })

    test("A moves to end of line and enters insert", () => {
      const ctx = createMockContext("hello\nworld", 2)
      const result = engine.handleKey(ctx, "A")
      expect(result.enterInsert).toBe(true)
      expect(ctx.cursorOffset).toBe(5)
    })

    test("o opens line below and enters insert", () => {
      const ctx = createMockContext("hello\nworld", 2)
      const result = engine.handleKey(ctx, "o")
      expect(result.enterInsert).toBe(true)
      expect(ctx.text).toBe("hello\n\nworld")
      expect(ctx.cursorOffset).toBe(6) // start of new empty line
    })

    test("O opens line above and enters insert", () => {
      const ctx = createMockContext("hello\nworld", 8)
      const result = engine.handleKey(ctx, "O")
      expect(result.enterInsert).toBe(true)
      expect(ctx.text).toBe("hello\n\nworld")
      expect(ctx.cursorOffset).toBe(6)
    })
  })

  describe("basic navigation", () => {
    test("h moves cursor left", () => {
      const ctx = createMockContext("hello", 3)
      engine.handleKey(ctx, "h")
      expect(ctx.cursorOffset).toBe(2)
    })

    test("l moves cursor right", () => {
      const ctx = createMockContext("hello", 2)
      engine.handleKey(ctx, "l")
      expect(ctx.cursorOffset).toBe(3)
    })

    test("j moves cursor down", () => {
      const ctx = createMockContext("hello\nworld", 2)
      engine.handleKey(ctx, "j")
      expect(ctx.cursorLine).toBe(1)
    })

    test("k moves cursor up", () => {
      const ctx = createMockContext("hello\nworld", 8)
      engine.handleKey(ctx, "k")
      expect(ctx.cursorLine).toBe(0)
    })

    test("0 moves to line start", () => {
      const ctx = createMockContext("hello", 3)
      engine.handleKey(ctx, "0")
      expect(ctx.cursorOffset).toBe(0)
    })

    test("$ moves to line end", () => {
      const ctx = createMockContext("hello\nworld", 2)
      engine.handleKey(ctx, "$")
      expect(ctx.cursorOffset).toBe(5)
    })

    test("^ moves to first non-blank", () => {
      const ctx = createMockContext("  hello", 5)
      engine.handleKey(ctx, "^")
      expect(ctx.cursorOffset).toBe(2)
    })

    test("G moves to buffer end", () => {
      const ctx = createMockContext("hello\nworld", 2)
      engine.handleKey(ctx, "G")
      expect(ctx.cursorOffset).toBe(11) // end of buffer
    })

    test("gg moves to buffer start", () => {
      const ctx = createMockContext("hello\nworld", 8)
      engine.handleKey(ctx, "g")
      engine.handleKey(ctx, "g")
      expect(ctx.cursorOffset).toBe(0)
    })
  })

  describe("word navigation", () => {
    test("w moves to next word start", () => {
      const ctx = createMockContext("hello world", 0)
      engine.handleKey(ctx, "w")
      expect(ctx.cursorOffset).toBe(6)
    })

    test("W moves to next WORD start", () => {
      const ctx = createMockContext("foo,bar baz", 0)
      engine.handleKey(ctx, "W")
      expect(ctx.cursorOffset).toBe(8)
    })

    test("b moves to previous word start", () => {
      const ctx = createMockContext("hello world", 8)
      engine.handleKey(ctx, "b")
      expect(ctx.cursorOffset).toBe(6)
    })

    test("B moves to previous WORD start", () => {
      const ctx = createMockContext("foo,bar baz", 9)
      engine.handleKey(ctx, "B")
      expect(ctx.cursorOffset).toBe(8)
    })

    test("e moves to word end", () => {
      const ctx = createMockContext("hello world", 0)
      engine.handleKey(ctx, "e")
      expect(ctx.cursorOffset).toBe(4)
    })

    test("E moves to WORD end", () => {
      const ctx = createMockContext("foo,bar baz", 0)
      engine.handleKey(ctx, "E")
      expect(ctx.cursorOffset).toBe(6)
    })
  })

  describe("paragraph navigation", () => {
    test("{ moves to current paragraph start", () => {
      const ctx = createMockContext("one\n\ntwo\n\nthree", 7)
      engine.handleKey(ctx, "{")
      expect(ctx.cursorOffset).toBe(ctx.lineStart(2))
    })

    test("{ at paragraph start moves to previous paragraph", () => {
      const ctx = createMockContext("one\n\ntwo\n\nthree", 5)
      engine.handleKey(ctx, "{")
      expect(ctx.cursorOffset).toBe(0)
    })

    test("} moves to next paragraph start", () => {
      const ctx = createMockContext("one\n\ntwo\n\nthree", 6)
      engine.handleKey(ctx, "}")
      expect(ctx.cursorOffset).toBe(ctx.lineStart(4))
    })
  })

  describe("character search", () => {
    test("f{c} jumps to character", () => {
      const ctx = createMockContext("hello world", 0)
      engine.handleKey(ctx, "f")
      engine.handleKey(ctx, "o")
      expect(ctx.cursorOffset).toBe(4)
    })

    test("F{c} jumps backward to character", () => {
      const ctx = createMockContext("hello world", 8)
      engine.handleKey(ctx, "F")
      engine.handleKey(ctx, "o")
      expect(ctx.cursorOffset).toBe(7)
    })

    test("t{c} jumps to before character", () => {
      const ctx = createMockContext("hello world", 0)
      engine.handleKey(ctx, "t")
      engine.handleKey(ctx, "o")
      expect(ctx.cursorOffset).toBe(3)
    })

    test("T{c} jumps to after character backward", () => {
      const ctx = createMockContext("hello world", 8)
      engine.handleKey(ctx, "T")
      engine.handleKey(ctx, "l")
      expect(ctx.cursorOffset).toBe(4)
    })

    test("; repeats last f search", () => {
      const ctx = createMockContext("abcabc", 0)
      engine.handleKey(ctx, "f")
      engine.handleKey(ctx, "b")
      expect(ctx.cursorOffset).toBe(1)
      engine.handleKey(ctx, ";")
      expect(ctx.cursorOffset).toBe(4)
    })

    test(", reverses last f search", () => {
      const ctx = createMockContext("abcabc", 4)
      engine.handleKey(ctx, "f")
      engine.handleKey(ctx, "c")
      expect(ctx.cursorOffset).toBe(5)
      engine.handleKey(ctx, ",")
      expect(ctx.cursorOffset).toBe(2)
    })
  })

  describe("delete operations", () => {
    test("x deletes char at cursor", () => {
      const ctx = createMockContext("hello", 2)
      engine.handleKey(ctx, "x")
      expect(ctx.text).toBe("helo")
    })

    test("dd deletes current line", () => {
      const ctx = createMockContext("hello\nworld\nfoo", 7)
      engine.handleKey(ctx, "d")
      engine.handleKey(ctx, "d")
      expect(ctx.text).toBe("hello\nfoo")
    })

    test("dw deletes to next word", () => {
      const ctx = createMockContext("hello world", 0)
      engine.handleKey(ctx, "d")
      engine.handleKey(ctx, "w")
      expect(ctx.text).toBe("world")
    })

    test("D deletes to end of line", () => {
      const ctx = createMockContext("hello world", 5)
      engine.handleKey(ctx, "D")
      expect(ctx.text).toBe("hello")
    })

    test("db deletes backward to word start", () => {
      const ctx = createMockContext("hello world", 11)
      engine.handleKey(ctx, "d")
      engine.handleKey(ctx, "b")
      expect(ctx.text).toBe("hello ")
    })
  })

  describe("change operations", () => {
    test("cw deletes word and enters insert", () => {
      const ctx = createMockContext("hello world", 0)
      const r1 = engine.handleKey(ctx, "c")
      expect(r1.handled).toBe(true)
      expect(r1.enterInsert).toBeUndefined()

      const r2 = engine.handleKey(ctx, "w")
      expect(r2.handled).toBe(true)
      expect(r2.enterInsert).toBe(true)
      expect(ctx.text).toBe("world")
    })

    test("cc changes entire line (enters insert)", () => {
      const ctx = createMockContext("hello\nworld", 2)
      engine.handleKey(ctx, "c")
      const result = engine.handleKey(ctx, "c")
      expect(result.enterInsert).toBe(true)
      expect(ctx.text).toBe("\nworld")
    })

    test("C changes to end of line (enters insert)", () => {
      const ctx = createMockContext("hello world", 5)
      const result = engine.handleKey(ctx, "C")
      expect(result.enterInsert).toBe(true)
      expect(ctx.text).toBe("hello")
    })
  })

  describe("text objects", () => {
    test("diw deletes inner word", () => {
      const ctx = createMockContext("hello world", 7)
      engine.handleKey(ctx, "d")
      engine.handleKey(ctx, "i")
      engine.handleKey(ctx, "w")
      expect(ctx.text).toBe("hello ")
    })

    test("daw deletes around word (including trailing space)", () => {
      const ctx = createMockContext("hello world foo", 6)
      engine.handleKey(ctx, "d")
      engine.handleKey(ctx, "a")
      engine.handleKey(ctx, "w")
      expect(ctx.text).toBe("hello foo")
    })

    test('ci" changes inner quotes', () => {
      const ctx = createMockContext('say "hello" please', 7)
      engine.handleKey(ctx, "c")
      engine.handleKey(ctx, "i")
      const result = engine.handleKey(ctx, '"')
      expect(result.enterInsert).toBe(true)
      expect(ctx.text).toBe('say "" please')
    })

    test("di( deletes inner parentheses", () => {
      const ctx = createMockContext("foo(bar baz)end", 6)
      engine.handleKey(ctx, "d")
      engine.handleKey(ctx, "i")
      engine.handleKey(ctx, "(")
      expect(ctx.text).toBe("foo()end")
    })

    test("da[ deletes around brackets", () => {
      const ctx = createMockContext("foo[bar]end", 5)
      engine.handleKey(ctx, "d")
      engine.handleKey(ctx, "a")
      engine.handleKey(ctx, "[")
      expect(ctx.text).toBe("fooend")
    })
  })

  describe("yank and paste", () => {
    test("yy + p yanks and pastes a line below", () => {
      const ctx = createMockContext("hello\nworld", 2)
      engine.handleKey(ctx, "y")
      engine.handleKey(ctx, "y")
      engine.handleKey(ctx, "p")
      expect(ctx.text).toBe("hello\nhello\nworld")
    })

    test("yw + p yanks word and pastes after cursor", () => {
      const ctx = createMockContext("hello world", 0)
      engine.handleKey(ctx, "y")
      engine.handleKey(ctx, "w")
      // Cursor is at 0, paste after puts it at position 1
      engine.handleKey(ctx, "p")
      expect(ctx.text).toBe("hhello ello world")
    })

    test("Y + P yanks line and pastes above", () => {
      const ctx = createMockContext("hello\nworld", 7)
      engine.handleKey(ctx, "Y")
      engine.handleKey(ctx, "P")
      expect(ctx.text).toBe("hello\nworld\nworld")
    })
  })

  describe("repeat with dot", () => {
    test(". repeats x (delete char)", () => {
      const ctx = createMockContext("hello", 0)
      engine.handleKey(ctx, "x") // deletes 'h' -> "ello"
      expect(ctx.text).toBe("ello")
      engine.handleKey(ctx, ".") // deletes 'e' -> "llo"
      expect(ctx.text).toBe("llo")
    })

    test(". repeats dd (delete line)", () => {
      const ctx = createMockContext("aaa\nbbb\nccc", 0)
      engine.handleKey(ctx, "d")
      engine.handleKey(ctx, "d")
      expect(ctx.text).toBe("bbb\nccc")
      engine.handleKey(ctx, ".")
      expect(ctx.text).toBe("ccc")
    })
  })

  describe("indent and dedent", () => {
    test(">> indents the current line", () => {
      const ctx = createMockContext("hello\nworld", 0)
      engine.handleKey(ctx, ">")
      engine.handleKey(ctx, ">")
      expect(ctx.text).toBe("  hello\nworld")
    })

    test("<< dedents the current line", () => {
      const ctx = createMockContext("  hello\nworld", 2)
      engine.handleKey(ctx, "<")
      engine.handleKey(ctx, "<")
      expect(ctx.text).toBe("hello\nworld")
    })
  })

  describe("join lines", () => {
    test("J joins current line with next", () => {
      const ctx = createMockContext("hello\nworld", 2)
      engine.handleKey(ctx, "J")
      expect(ctx.text).toBe("hello world")
      expect(ctx.cursorOffset).toBe(5)
    })

    test("J with leading whitespace on next line trims it", () => {
      const ctx = createMockContext("hello\n  world", 0)
      engine.handleKey(ctx, "J")
      expect(ctx.text).toBe("hello world")
    })
  })

  describe("pending state", () => {
    test("reset() clears all pending state", () => {
      const ctx = createMockContext("hello")
      engine.handleKey(ctx, "d") // enter pending operator
      expect(engine.pendingDisplay).toBe("d")
      engine.reset()
      expect(engine.pendingDisplay).toBe("")
    })

    test("Escape-triggered reset clears pending g", () => {
      const ctx = createMockContext("hello")
      engine.handleKey(ctx, "g") // enter pending g
      expect(engine.pendingDisplay).toBe("g")
      engine.reset()
      expect(engine.pendingDisplay).toBe("")
    })

    test("pending f is cleared after receiving char", () => {
      const ctx = createMockContext("hello", 0)
      engine.handleKey(ctx, "f")
      expect(engine.pendingDisplay).toBe("f")
      engine.handleKey(ctx, "l")
      expect(engine.pendingDisplay).toBe("")
    })

    test("unknown g-command resets pending", () => {
      const ctx = createMockContext("hello", 0)
      engine.handleKey(ctx, "g")
      engine.handleKey(ctx, "x") // unknown g-command
      expect(engine.pendingDisplay).toBe("")
    })
  })

  describe("operator + char search", () => {
    test("df{c} deletes through character", () => {
      const ctx = createMockContext("hello world", 0)
      engine.handleKey(ctx, "d")
      engine.handleKey(ctx, "f")
      engine.handleKey(ctx, "o")
      expect(ctx.text).toBe(" world")
    })

    test("ct{c} changes up to character", () => {
      const ctx = createMockContext("hello world", 0)
      engine.handleKey(ctx, "c")
      engine.handleKey(ctx, "t")
      const result = engine.handleKey(ctx, " ")
      expect(result.enterInsert).toBe(true)
      expect(ctx.text).toBe(" world")
    })
  })

  describe("operator + gg motion", () => {
    test("dgg deletes from cursor to buffer start", () => {
      const ctx = createMockContext("hello world", 6)
      engine.handleKey(ctx, "d")
      engine.handleKey(ctx, "g")
      engine.handleKey(ctx, "g")
      expect(ctx.text).toBe("world")
    })
  })
})
