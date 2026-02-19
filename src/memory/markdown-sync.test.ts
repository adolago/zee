/**
 * Markdown Sync Tests (Gap 1)
 *
 * Pure filesystem tests using tmpdir (no Qdrant required):
 * - appendToDailyLog(): creates dated file, appends entries
 * - Multiple entries same day -> same file
 * - writeEntityPage() / readEntityPage() round-trip
 * - listEntityPages() and listDailyLogs() enumeration
 * - Metadata preserved in HTML comments
 * - Special characters in entity names sanitized
 */

import { describe, it, expect, afterAll, vi } from "vitest"

// Mock Bun-dependent modules before any imports that trigger them
vi.mock("../../packages/zee/src/global/index", () => ({
  Global: {
    Path: {
      home: "/tmp/test",
      source: "/tmp/test",
      data: "/tmp/test/data",
      bin: "/tmp/test/bin",
      log: "/tmp/test/log",
      cache: "/tmp/test/cache",
      config: "/tmp/test/config",
      state: "/tmp/test/state",
      tmp: "/tmp/test/tmp",
    },
  },
}))

vi.mock("../../packages/zee/src/util/log", () => {
  const noop = () => {}
  const noopLogger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    tag: () => noopLogger,
    clone: () => noopLogger,
    time: () => ({ stop: noop, [Symbol.dispose]: noop }),
  }
  return {
    Log: {
      create: () => noopLogger,
      Default: noopLogger,
      Level: { parse: (v: string) => v },
      init: async () => {},
      file: () => "",
    },
  }
})

import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { MarkdownSync } from "./markdown-sync"
import type { MemoryEntry } from "./types"

const testDir = mkdtempSync(join(tmpdir(), "memv2-md-sync-"))
let mdSync: MarkdownSync

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now()
  return {
    id: `test-${Math.random().toString(36).slice(2, 10)}`,
    category: "fact",
    content: "Test memory content",
    metadata: {},
    createdAt: now,
    accessedAt: now,
    ...overrides,
  }
}

afterAll(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe("MarkdownSync", () => {
  it("uses XDG state path as default baseDir", () => {
    const defaultSync = new MarkdownSync()
    expect(defaultSync.getBaseDir()).toBe(join(homedir(), ".local", "state", "zee", "memory"))
  })

  it("creates instance with custom baseDir", () => {
    mdSync = new MarkdownSync({ baseDir: testDir, enabled: true })
    expect(mdSync.isEnabled()).toBe(true)
    expect(mdSync.getBaseDir()).toBe(testDir)
  })

  describe("appendToDailyLog", () => {
    it("creates a dated file and appends entry with timestamp", () => {
      const entry = makeEntry({
        content: "First entry of the day",
        category: "note",
        createdAt: new Date("2025-06-15T10:30:00").getTime(),
      })

      mdSync.appendToDailyLog(entry)

      const filePath = join(testDir, "2025-06-15.md")
      expect(existsSync(filePath)).toBe(true)

      const content = readFileSync(filePath, "utf-8")
      expect(content).toContain("Sunday, June 15, 2025")
      expect(content).toContain("note")
      expect(content).toContain("First entry of the day")
      expect(content).toContain("---")
    })

    it("appends multiple entries to the same day file", () => {
      const entry2 = makeEntry({
        content: "Second entry same day",
        category: "fact",
        createdAt: new Date("2025-06-15T14:00:00").getTime(),
      })

      mdSync.appendToDailyLog(entry2)

      const filePath = join(testDir, "2025-06-15.md")
      const content = readFileSync(filePath, "utf-8")

      // Header appears only once
      const headerCount = (content.match(/# Sunday, June 15, 2025/g) || []).length
      expect(headerCount).toBe(1)

      // Both entries present
      expect(content).toContain("First entry of the day")
      expect(content).toContain("Second entry same day")
    })

    it("includes confidence tag when confidence is set", () => {
      const entry = makeEntry({
        content: "Belief with confidence",
        confidence: 0.85,
        createdAt: new Date("2025-07-01T09:00:00").getTime(),
      })

      mdSync.appendToDailyLog(entry)

      const filePath = join(testDir, "2025-07-01.md")
      const content = readFileSync(filePath, "utf-8")
      expect(content).toContain("{85%}")
    })

    it("includes version tag for versioned entries", () => {
      const entry = makeEntry({
        content: "Versioned entry",
        version: 3,
        createdAt: new Date("2025-07-02T12:00:00").getTime(),
      })

      mdSync.appendToDailyLog(entry)

      const filePath = join(testDir, "2025-07-02.md")
      const content = readFileSync(filePath, "utf-8")
      expect(content).toContain("(v3)")
    })

    it("includes domain/topic/subtopic location", () => {
      const entry = makeEntry({
        content: "Located entry",
        domain: "tech",
        topic: "rust",
        subtopic: "lifetimes",
        createdAt: new Date("2025-07-03T08:00:00").getTime(),
      })

      mdSync.appendToDailyLog(entry)

      const filePath = join(testDir, "2025-07-03.md")
      const content = readFileSync(filePath, "utf-8")
      expect(content).toContain("[tech/rust/lifetimes]")
    })

    it("preserves metadata in HTML comments", () => {
      const entry = makeEntry({
        content: "Entry with metadata",
        metadata: {
          tags: ["important", "review"],
          entities: ["Alice", "Bob"],
        },
        kind: "curated",
        priority: "high",
        bookmarked: true,
        createdAt: new Date("2025-07-04T16:00:00").getTime(),
      })

      mdSync.appendToDailyLog(entry)

      const filePath = join(testDir, "2025-07-04.md")
      const content = readFileSync(filePath, "utf-8")
      expect(content).toContain("<!-- ")
      expect(content).toContain("tags:important,review")
      expect(content).toContain("entities:Alice,Bob")
      expect(content).toContain("kind:curated")
      expect(content).toContain("priority:high")
      expect(content).toContain("bookmarked")
    })
  })

  describe("writeEntityPage / readEntityPage", () => {
    it("writes and reads an entity page round-trip", () => {
      mdSync.writeEntityPage("Qdrant", {
        summary: "Qdrant is a vector database",
        facts: [
          { content: "Written in Rust", confidence: 0.95, date: "2025-01-01" },
          { content: "Supports filtering", date: "2025-01-02" },
        ],
        relationships: [{ target: "Rust", type: "built_with" }],
      })

      const content = mdSync.readEntityPage("Qdrant")
      expect(content).not.toBeNull()
      expect(content).toContain("# Qdrant")
      expect(content).toContain("Qdrant is a vector database")
      expect(content).toContain("Written in Rust")
      expect(content).toContain("95% confidence")
      expect(content).toContain("Supports filtering")
      expect(content).toContain("built_with -> Rust")
    })

    it("returns null for non-existent entity", () => {
      const content = mdSync.readEntityPage("NonExistentEntity12345")
      expect(content).toBeNull()
    })
  })

  describe("listEntityPages", () => {
    it("lists created entity pages", () => {
      mdSync.writeEntityPage("TestEntity", {
        summary: "A test entity",
        facts: [],
      })

      const pages = mdSync.listEntityPages()
      expect(pages).toContain("qdrant")
      expect(pages).toContain("testentity")
    })
  })

  describe("listDailyLogs", () => {
    it("lists available daily log dates sorted", () => {
      const logs = mdSync.listDailyLogs()
      expect(logs.length).toBeGreaterThanOrEqual(1)
      expect(logs).toContain("2025-06-15")

      // Verify sorted
      for (let i = 1; i < logs.length; i++) {
        expect(logs[i] >= logs[i - 1]).toBe(true)
      }
    })
  })

  describe("special characters in entity names", () => {
    it("sanitizes entity names for safe filenames", () => {
      mdSync.writeEntityPage("John O'Brien (CEO)", {
        summary: "CEO of a company",
        facts: [],
      })

      const pages = mdSync.listEntityPages()
      // Should be sanitized (no apostrophes, parens, etc.)
      const match = pages.find((p) => p.includes("john"))
      expect(match).toBeDefined()
      expect(match).not.toContain("'")
      expect(match).not.toContain("(")
      expect(match).not.toContain(")")

      // Should still be readable
      const content = mdSync.readEntityPage("John O'Brien (CEO)")
      expect(content).not.toBeNull()
      expect(content).toContain("John O'Brien (CEO)")
    })

    it("handles emoji and unicode in entity names", () => {
      mdSync.writeEntityPage("Cafe Muller", {
        summary: "A cafe",
        facts: [],
      })

      const content = mdSync.readEntityPage("Cafe Muller")
      expect(content).not.toBeNull()
    })
  })

  describe("disabled sync", () => {
    it("no-ops when disabled", () => {
      const disabled = new MarkdownSync({ baseDir: testDir, enabled: false })
      expect(disabled.isEnabled()).toBe(false)
      expect(disabled.listDailyLogs()).toEqual([])
      expect(disabled.listEntityPages()).toEqual([])
    })
  })

})
