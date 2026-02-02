import { describe, test, expect, afterEach } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { TextareaRenderable } from "@opentui/core"
import { VimCommands } from "../src/cli/cmd/tui/util/vim-commands"

/**
 * Integration tests that exercise VimEngine commands against a real
 * TextareaRenderable backed by @opentui/core's native Zig EditBuffer.
 *
 * Unlike the mock-context tests in vim-mode-switching.integration.test.ts,
 * these catch integration issues with grapheme-aware cursor positioning,
 * the native rope data structure, and real cursorOffset get/set through
 * the Zig FFI layer.
 */

interface VimTextarea {
  textarea: TextareaRenderable
  engine: VimCommands.VimEngine
  ctx: () => VimCommands.VimCommandContext
  vim: (...keys: string[]) => VimCommands.VimCommandResult
  mockInput: Awaited<ReturnType<typeof createTestRenderer>>["mockInput"]
  renderOnce: () => Promise<void>
  expectText: (expected: string) => void
  expectCursor: (offset: number) => void
  destroy: () => void
}

async function createVimTextarea(initialText = ""): Promise<VimTextarea> {
  const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 60, height: 10 })
  const textarea = new TextareaRenderable(renderer.root.ctx, { placeholder: null })
  renderer.root.add(textarea)
  textarea.focus()
  await renderOnce()

  if (initialText) {
    textarea.setText(initialText)
    textarea.cursorOffset = 0
    await renderOnce()
  }

  const engine = new VimCommands.VimEngine()

  function ctx(): VimCommands.VimCommandContext {
    return {
      get cursorOffset() { return textarea.cursorOffset },
      set cursorOffset(offset: number) { textarea.cursorOffset = offset },
      get text() { return textarea.plainText },
      setText(text: string) { textarea.setText(text) },
      insertText(text: string) { textarea.insertText(text) },
      deleteRange(start: number, end: number): string {
        const text = textarea.plainText
        const deleted = text.slice(start, end)
        textarea.setText(text.slice(0, start) + text.slice(end))
        return deleted
      },
      gotoBufferStart() { textarea.cursorOffset = 0 },
      gotoBufferEnd() { textarea.gotoBufferEnd() },
      get cursorLine(): number {
        const text = textarea.plainText
        const before = text.slice(0, textarea.cursorOffset)
        return (before.match(/\n/g) ?? []).length
      },
      get cursorColumn(): number {
        const text = textarea.plainText
        const before = text.slice(0, textarea.cursorOffset)
        const lastNewline = before.lastIndexOf("\n")
        return lastNewline === -1 ? textarea.cursorOffset : textarea.cursorOffset - lastNewline - 1
      },
      get lines(): string[] {
        return textarea.plainText.split("\n")
      },
      lineStart(line: number): number {
        const lines = textarea.plainText.split("\n")
        let offset = 0
        for (let i = 0; i < line && i < lines.length; i++) {
          offset += lines[i]!.length + 1
        }
        return offset
      },
      lineEnd(line: number): number {
        const lines = textarea.plainText.split("\n")
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
          textarea.cursorOffset = start + Math.min(col, prevLineLen)
        }
      },
      moveCursorDown() {
        const col = this.cursorColumn
        const line = this.cursorLine
        const lines = this.lines
        if (line < lines.length - 1) {
          const start = this.lineStart(line + 1)
          const nextLineLen = lines[line + 1]?.length ?? 0
          textarea.cursorOffset = start + Math.min(col, nextLineLen)
        }
      },
    }
  }

  function vim(...keys: string[]): VimCommands.VimCommandResult {
    let result: VimCommands.VimCommandResult = { handled: false }
    for (const key of keys) {
      result = engine.handleKey(ctx(), key)
    }
    return result
  }

  function expectText(expected: string) {
    expect(textarea.plainText).toBe(expected)
  }

  function expectCursor(offset: number) {
    expect(textarea.cursorOffset).toBe(offset)
  }

  return {
    textarea, engine, ctx, vim, mockInput, renderOnce,
    expectText, expectCursor, destroy: () => renderer.destroy(),
  }
}

describe("VimEngine + TextareaRenderable integration", () => {
  let v: VimTextarea

  afterEach(() => {
    v?.destroy()
  })

  // -- Insert mode entry --

  describe("insert mode entry", () => {
    test("i enters insert at current position", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      const result = v.vim("i")
      expect(result.enterInsert).toBe(true)
      v.expectCursor(5)
    })

    test("I enters insert at first non-whitespace", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      const result = v.vim("I")
      expect(result.enterInsert).toBe(true)
      v.expectCursor(0)
    })

    test("a enters insert after current position", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      const result = v.vim("a")
      expect(result.enterInsert).toBe(true)
      v.expectCursor(6)
    })

    test("A enters insert at end of line", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      const result = v.vim("A")
      expect(result.enterInsert).toBe(true)
      v.expectCursor(11)
    })

    test("o opens line below and enters insert", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      const result = v.vim("o")
      expect(result.enterInsert).toBe(true)
      v.expectText("hello world\n")
    })

    test("O opens line above and enters insert", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      const result = v.vim("O")
      expect(result.enterInsert).toBe(true)
      v.expectText("\nhello world")
      v.expectCursor(0)
    })
  })

  // -- Navigation --

  describe("navigation", () => {
    test("h moves cursor left", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      v.vim("h")
      v.expectCursor(4)
    })

    test("l moves cursor right", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      v.vim("l")
      v.expectCursor(6)
    })

    test("0 moves to start of line", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      v.vim("0")
      v.expectCursor(0)
    })

    test("$ moves to end of line", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      v.vim("$")
      v.expectCursor(11) // lineEnd returns length of line
    })

    test("^ moves to first non-whitespace", async () => {
      v = await createVimTextarea("  hello")
      v.textarea.cursorOffset = 5
      v.vim("^")
      v.expectCursor(2)
    })

    test("w moves to next word start", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 0
      v.vim("w")
      v.expectCursor(6)
    })

    test("e moves to end of word", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 0
      v.vim("e")
      v.expectCursor(4)
    })

    test("b moves to previous word start", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 8
      v.vim("b")
      v.expectCursor(6)
    })
  })

  describe("multiline navigation", () => {
    test("j moves cursor down", async () => {
      v = await createVimTextarea("first\nsecond\nthird")
      v.textarea.cursorOffset = 0
      v.vim("j")
      v.expectCursor(6)
    })

    test("k moves cursor up from second line", async () => {
      v = await createVimTextarea("first\nsecond\nthird")
      v.textarea.cursorOffset = 6
      v.vim("k")
      v.expectCursor(0)
    })

    test("gg goes to buffer start", async () => {
      v = await createVimTextarea("first\nsecond\nthird")
      v.textarea.cursorOffset = 14
      v.vim("g", "g")
      v.expectCursor(0)
    })

    test("G goes to buffer end", async () => {
      v = await createVimTextarea("first\nsecond\nthird")
      v.textarea.cursorOffset = 0
      v.vim("G")
      // G calls gotoBufferEnd() which places cursor at end of text
      v.expectCursor(v.textarea.plainText.length)
    })
  })

  // -- Character search --

  describe("character search", () => {
    test("f finds character forward", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 0
      v.vim("f", "w")
      v.expectCursor(6)
    })

    test("F finds character backward", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 10
      v.vim("F", "w")
      v.expectCursor(6)
    })

    test("t moves to before character forward", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 0
      v.vim("t", "w")
      v.expectCursor(5)
    })

    test("T moves to after character backward", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 10
      v.vim("T", "w")
      v.expectCursor(7)
    })

    test("; repeats last character search", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 0
      v.vim("f", "l")
      const firstPos = v.textarea.cursorOffset
      v.vim(";")
      expect(v.textarea.cursorOffset).toBeGreaterThan(firstPos)
    })

    test(", repeats last character search in reverse", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 0
      v.vim("f", "l")
      v.vim(";")
      const pos = v.textarea.cursorOffset
      v.vim(",")
      expect(v.textarea.cursorOffset).toBeLessThan(pos)
    })
  })

  // -- Delete operations --

  describe("delete operations", () => {
    test("x deletes character under cursor", async () => {
      v = await createVimTextarea("hello")
      v.textarea.cursorOffset = 0
      v.vim("x")
      v.expectText("ello")
    })

    test("dw deletes word", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 0
      v.vim("d", "w")
      v.expectText("world")
    })

    test("dd deletes entire line", async () => {
      v = await createVimTextarea("first\nsecond\nthird")
      v.textarea.cursorOffset = 0
      v.vim("d", "d")
      v.expectText("second\nthird")
    })

    test("D deletes from cursor to end of line", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      v.vim("D")
      v.expectText("hello")
    })

    test("diw deletes inner word", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 7
      v.vim("d", "i", "w")
      v.expectText("hello ")
    })

    test('da" deletes around double quotes', async () => {
      v = await createVimTextarea('say "hello" end')
      v.textarea.cursorOffset = 6
      v.vim("d", "a", '"')
      v.expectText("say  end")
    })

    test("di( deletes inside parentheses", async () => {
      v = await createVimTextarea("call(arg1, arg2)")
      v.textarea.cursorOffset = 6
      v.vim("d", "i", "(")
      v.expectText("call()")
    })
  })

  // -- Change operations --

  describe("change operations", () => {
    test("cw changes word and enters insert", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 0
      const result = v.vim("c", "w")
      expect(result.enterInsert).toBe(true)
      v.expectText("world")
    })

    test("cc changes entire line and enters insert", async () => {
      v = await createVimTextarea("first\nsecond\nthird")
      v.textarea.cursorOffset = 6
      const result = v.vim("c", "c")
      expect(result.enterInsert).toBe(true)
      const lines = v.textarea.plainText.split("\n")
      expect(lines.length).toBe(3)
      expect(lines[1]).toBe("")
    })

    test("C changes from cursor to end of line", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 5
      const result = v.vim("C")
      expect(result.enterInsert).toBe(true)
      v.expectText("hello")
    })

    test("ciw changes inner word", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 7
      const result = v.vim("c", "i", "w")
      expect(result.enterInsert).toBe(true)
      v.expectText("hello ")
    })

    test('ci" changes inside double quotes', async () => {
      v = await createVimTextarea('say "hello" end')
      v.textarea.cursorOffset = 6
      const result = v.vim("c", "i", '"')
      expect(result.enterInsert).toBe(true)
      v.expectText('say "" end')
    })
  })

  // -- Yank and paste --

  describe("yank and paste", () => {
    test("yy + p pastes line below", async () => {
      v = await createVimTextarea("first\nsecond")
      v.textarea.cursorOffset = 0
      v.vim("y", "y")
      v.vim("p")
      v.expectText("first\nfirst\nsecond")
    })

    test("yw + p pastes word", async () => {
      v = await createVimTextarea("hello world")
      v.textarea.cursorOffset = 0
      v.vim("y", "w")
      v.textarea.cursorOffset = 11
      v.vim("p")
      v.expectText("hello worldhello ")
    })

    test("Y + P pastes line above", async () => {
      v = await createVimTextarea("first\nsecond")
      v.textarea.cursorOffset = 6
      v.vim("Y")
      v.vim("P")
      v.expectText("first\nsecond\nsecond")
    })
  })

  // -- Repeat --

  describe("dot repeat", () => {
    test(". repeats x deletion", async () => {
      v = await createVimTextarea("abcde")
      v.textarea.cursorOffset = 0
      v.vim("x")
      v.expectText("bcde")
      v.vim(".")
      v.expectText("cde")
    })

    test(". repeats dd deletion", async () => {
      v = await createVimTextarea("first\nsecond\nthird")
      v.textarea.cursorOffset = 0
      v.vim("d", "d")
      v.expectText("second\nthird")
      v.vim(".")
      v.expectText("third")
    })
  })

  // -- Indent and join --

  describe("indent and join", () => {
    test(">> indents line", async () => {
      v = await createVimTextarea("hello")
      v.textarea.cursorOffset = 0
      v.vim(">", ">")
      expect(v.textarea.plainText.startsWith("  ")).toBe(true)
    })

    test("<< dedents line", async () => {
      v = await createVimTextarea("  hello")
      v.textarea.cursorOffset = 0
      v.vim("<", "<")
      v.expectText("hello")
    })

    test("J joins current line with next", async () => {
      v = await createVimTextarea("hello\nworld")
      v.textarea.cursorOffset = 0
      v.vim("J")
      v.expectText("hello world")
    })
  })

  // -- Full workflow: type text then use vim commands --

  describe("end-to-end workflow", () => {
    test("type text via insertText, then use vim to navigate and delete", async () => {
      v = await createVimTextarea()
      v.textarea.insertText("hello world")
      await v.renderOnce()
      v.expectText("hello world")

      v.vim("0")
      v.vim("d", "w")
      v.expectText("world")
    })

    test("vim operations preserve textarea state across multiple edits", async () => {
      v = await createVimTextarea("line one\nline two\nline three")

      v.textarea.cursorOffset = 0
      v.vim("d", "d")
      v.expectText("line two\nline three")

      v.vim("J")
      v.expectText("line two line three")

      v.vim("A")
      v.textarea.insertText("!")
      v.expectText("line two line three!")
    })

    test("cursor offset stays consistent through vim and textarea ops", async () => {
      v = await createVimTextarea("abcdef")
      v.textarea.cursorOffset = 0

      v.vim("0")
      v.expectCursor(0)

      v.vim("x")
      v.vim("x")
      v.expectText("cdef")
      v.expectCursor(0)

      v.vim("$")
      v.expectCursor(4) // lineEnd of "cdef" = length 4
    })
  })
})
