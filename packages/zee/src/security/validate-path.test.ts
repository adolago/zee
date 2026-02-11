import { describe, it, expect } from "vitest"
import os from "node:os"
import path from "node:path"
import {
  validateToolPath,
  validateMediaPath,
  PathValidationError,
} from "./validate-path"

const HOME = os.homedir()
const CWD = path.join(HOME, "projects", "test")

describe("validateToolPath", () => {
  it("resolves a path within sandbox root", () => {
    const result = validateToolPath({
      filePath: "file.txt",
      cwd: CWD,
      root: HOME,
    })
    expect(result.resolved).toBe(path.join(CWD, "file.txt"))
    expect(result.relative).not.toMatch(/^\.\./)
  })

  it("resolves absolute path within sandbox root", () => {
    const result = validateToolPath({
      filePath: path.join(HOME, "docs", "readme.md"),
      cwd: CWD,
      root: HOME,
    })
    expect(result.resolved).toBe(path.join(HOME, "docs", "readme.md"))
  })

  it("rejects path escaping sandbox root", () => {
    expect(() =>
      validateToolPath({
        filePath: "/tmp/outside",
        cwd: CWD,
        root: HOME,
      }),
    ).toThrow(PathValidationError)
  })

  it("rejects .. traversal", () => {
    expect(() =>
      validateToolPath({
        filePath: "../../../etc/passwd",
        cwd: CWD,
        root: HOME,
      }),
    ).toThrow(PathValidationError)
  })

  it("blocks sensitive system paths", () => {
    expect(() =>
      validateToolPath({
        filePath: "/etc/shadow",
        cwd: CWD,
        root: "/",
        permissive: true,
      }),
    ).toThrow("sensitive system location")
  })

  it("blocks sensitive home directories", () => {
    expect(() =>
      validateToolPath({
        filePath: path.join(HOME, ".ssh", "id_rsa"),
        cwd: CWD,
        root: HOME,
      }),
    ).toThrow("sensitive credentials")
  })

  it("blocks /proc paths", () => {
    expect(() =>
      validateToolPath({
        filePath: "/proc/self/environ",
        cwd: CWD,
        root: "/",
        permissive: true,
      }),
    ).toThrow("sensitive system location")
  })

  it("rejects empty paths", () => {
    expect(() =>
      validateToolPath({ filePath: "", cwd: CWD, root: HOME }),
    ).toThrow("Empty file path")
  })

  it("expands tilde paths", () => {
    const result = validateToolPath({
      filePath: "~/documents/file.txt",
      cwd: CWD,
      root: HOME,
    })
    expect(result.resolved).toBe(path.join(HOME, "documents", "file.txt"))
  })

  it("allows paths in permissive mode", () => {
    const result = validateToolPath({
      filePath: "/tmp/some-file.txt",
      cwd: CWD,
      root: HOME,
      permissive: true,
    })
    expect(result.resolved).toBe("/tmp/some-file.txt")
  })

  it("respects custom blocked prefixes", () => {
    expect(() =>
      validateToolPath({
        filePath: "/custom/blocked/file",
        cwd: CWD,
        root: "/",
        permissive: true,
        blockedPrefixes: ["/custom/blocked"],
      }),
    ).toThrow("sensitive system location")
  })
})

describe("validateMediaPath", () => {
  it("returns null for http URLs", () => {
    const result = validateMediaPath("https://example.com/image.png", { cwd: CWD })
    expect(result).toBeNull()
  })

  it("returns null for data URIs", () => {
    const result = validateMediaPath("data:image/png;base64,abc", { cwd: CWD })
    expect(result).toBeNull()
  })

  it("returns null for empty strings", () => {
    const result = validateMediaPath("", { cwd: CWD })
    expect(result).toBeNull()
  })

  it("validates local file paths", () => {
    const result = validateMediaPath("/tmp/image.png", {
      cwd: CWD,
      permissive: true,
    })
    expect(result).not.toBeNull()
    expect(result!.resolved).toBe("/tmp/image.png")
  })

  it("blocks sensitive local paths", () => {
    expect(() =>
      validateMediaPath(path.join(HOME, ".ssh/id_rsa"), {
        cwd: CWD,
        permissive: true,
      }),
    ).toThrow(PathValidationError)
  })
})
