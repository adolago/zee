import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "os"

describe("Symlink Vulnerability", () => {
  let tmpBase: string
  let projectDir: string
  let externalDir: string
  let symlinkPath: string

  beforeAll(async () => {
    tmpBase = await fs.mkdtemp(path.join(tmpdir(), "agent-core-security-test-"))
    projectDir = path.join(tmpBase, "project")
    externalDir = path.join(tmpBase, "external")

    await fs.mkdir(projectDir)
    await fs.mkdir(externalDir)

    // Create a symlink inside project pointing to external
    symlinkPath = path.join(projectDir, "link-to-external")
    await fs.symlink(externalDir, symlinkPath)

    // Create a symlink inside project pointing to a file in external
    await fs.writeFile(path.join(externalDir, "secret.txt"), "secret data")
    await fs.symlink(path.join(externalDir, "secret.txt"), path.join(projectDir, "link-to-secret.txt"))
  })

  afterAll(async () => {
    await fs.rm(tmpBase, { recursive: true, force: true })
  })

  it("Instance.containsPath returns false for symlink pointing outside (SECURE)", async () => {
    await Instance.provide({
      directory: projectDir,
      fn: async () => {
        // The target path is inside the symlinked directory
        const targetPath = path.join(symlinkPath, "new-file.txt")

        // Lexically it is inside projectDir
        const isInsideLexical = Filesystem.contains(projectDir, targetPath)
        expect(isInsideLexical).toBe(true)

        // Physically it is outside
        // Instance.containsPath uses strict check now, so it returns false
        expect(Instance.containsPath(targetPath)).toBe(false)
      },
    })
  })

  it("Filesystem.containsResolved returns false for symlink pointing outside (FIX)", async () => {
    // The target path is inside the symlinked directory
    const targetPath = path.join(symlinkPath, "new-file.txt")

    // containsResolved should detect this if checking parent
    const isContained = await Filesystem.containsResolved(projectDir, targetPath)

    // BUT, what if we check the direct symlink itself?
    const symlinkFile = path.join(projectDir, "link-to-secret.txt")
    const isSymlinkContained = await Filesystem.containsResolved(projectDir, symlinkFile)

    // realpath(symlinkFile) -> .../external/secret.txt
    // relative(projectDir, .../external/secret.txt) -> ../external/secret.txt -> starts with ..
    // So isSymlinkContained should be FALSE.
    expect(isSymlinkContained).toBe(false)
  })

  it("Filesystem.containsResolvedSync returns false for new file in symlink dir (FIX)", async () => {
    const targetPath = path.join(symlinkPath, "new-file.txt")
    // Currently, this might fail (return true) if implementation is vulnerable
    // We expect it to be false after fix.
    // For now, let's just see what it returns.
    // expect(Filesystem.containsResolvedSync(projectDir, targetPath)).toBe(false)
    const result = Filesystem.containsResolvedSync(projectDir, targetPath)
    // If result is true, it means it IS vulnerable even with containsResolvedSync currently.
    // We want to assert that we NEED to fix it.
    // So if it is currently true, we will fail this test once we implement the fix if we assert false.
    // Let's assert false, so we can verify the fix works later.
    expect(result).toBe(false)
  })
})
