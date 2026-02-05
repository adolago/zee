import { describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import { Filesystem } from "../../src/util/filesystem"

describe("util.filesystem", () => {
  test("exists() is true for files and directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    const file = path.join(tmp, "file.txt")
    const missing = path.join(tmp, "missing")

    await mkdir(dir, { recursive: true })
    await Bun.write(file, "hello")

    const cases = await Promise.all([Filesystem.exists(dir), Filesystem.exists(file), Filesystem.exists(missing)])

    expect(cases).toEqual([true, true, false])

    await rm(tmp, { recursive: true, force: true })
  })

  test("isDir() is true only for directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    const file = path.join(tmp, "file.txt")
    const missing = path.join(tmp, "missing")

    await mkdir(dir, { recursive: true })
    await Bun.write(file, "hello")

    const cases = await Promise.all([Filesystem.isDir(dir), Filesystem.isDir(file), Filesystem.isDir(missing)])

    expect(cases).toEqual([true, false, false])

    await rm(tmp, { recursive: true, force: true })
  })

  test("findFirstUp() returns the closest match", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir", "subdir")
    await mkdir(dir, { recursive: true })

    const file1 = path.join(tmp, "file.txt")
    const file2 = path.join(tmp, "dir", "file.txt")

    await Bun.write(file1, "root")
    await Bun.write(file2, "nested")

    const found = await Filesystem.findFirstUp("file.txt", dir, tmp)
    expect(found).toBe(file2)

    await rm(tmp, { recursive: true, force: true })
  })

  test("findFirstUp() returns undefined if not found", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    await mkdir(dir, { recursive: true })

    const found = await Filesystem.findFirstUp("missing.txt", dir, tmp)
    expect(found).toBeUndefined()

    await rm(tmp, { recursive: true, force: true })
  })

  test("containsResolved() rejects non-existent files in symlinked directories pointing outside", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const safeDir = path.join(tmp, "safe")
    await mkdir(safeDir, { recursive: true })

    const outsideTarget = os.tmpdir()
    const symlinkPath = path.join(safeDir, "link")

    // Create symlink: safeDir/link -> os.tmpdir()
    await symlink(outsideTarget, symlinkPath)

    // Check path: safeDir/link/non_existent_file
    // Should resolve to os.tmpdir()/non_existent_file
    // Which is OUTSIDE safeDir.
    const maliciousPath = path.join(symlinkPath, "non_existent_file")

    const isContained = await Filesystem.containsResolved(safeDir, maliciousPath)
    expect(isContained).toBe(false)

    // Sync version
    const isContainedSync = Filesystem.containsResolvedSync(safeDir, maliciousPath)
    expect(isContainedSync).toBe(false)

    await rm(tmp, { recursive: true, force: true })
  })

  test("containsResolved() accepts non-existent files in regular directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const safeDir = path.join(tmp, "safe")
    await mkdir(safeDir, { recursive: true })

    const safePath = path.join(safeDir, "non_existent_file")

    const isContained = await Filesystem.containsResolved(safeDir, safePath)
    expect(isContained).toBe(true)

    // Sync version
    const isContainedSync = Filesystem.containsResolvedSync(safeDir, safePath)
    expect(isContainedSync).toBe(true)

    await rm(tmp, { recursive: true, force: true })
  })
})
