import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  ensureAgentWorkspace,
  loadWorkspaceBootstrapFiles,
} from "./workspace.js"
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js"

describe("loadWorkspaceBootstrapFiles", () => {
  it("includes MEMORY.md when present", async () => {
    const tempDir = await makeTempWorkspace("zee-workspace-")
    await writeWorkspaceFile({ dir: tempDir, name: "MEMORY.md", content: "memory" })

    const files = await loadWorkspaceBootstrapFiles(tempDir)
    const memoryEntries = files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    )

    expect(memoryEntries).toHaveLength(1)
    expect(memoryEntries[0]?.missing).toBe(false)
    expect(memoryEntries[0]?.content).toBe("memory")
  })

  it("includes memory.md when MEMORY.md is absent", async () => {
    const tempDir = await makeTempWorkspace("zee-workspace-")
    await writeWorkspaceFile({ dir: tempDir, name: "memory.md", content: "alt" })

    const files = await loadWorkspaceBootstrapFiles(tempDir)
    const memoryEntries = files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    )

    expect(memoryEntries).toHaveLength(1)
    expect(memoryEntries[0]?.missing).toBe(false)
    expect(memoryEntries[0]?.content).toBe("alt")
  })

  it("omits memory entries when no memory files exist", async () => {
    const tempDir = await makeTempWorkspace("zee-workspace-")

    const files = await loadWorkspaceBootstrapFiles(tempDir)
    const memoryEntries = files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    )

    expect(memoryEntries).toHaveLength(0)
  })
})

describe("ensureAgentWorkspace", () => {
  it("does not auto-create HEARTBEAT.md when bootstrapping a new workspace", async () => {
    const tempDir = await makeTempWorkspace("zee-workspace-")

    await ensureAgentWorkspace({
      dir: tempDir,
      ensureBootstrapFiles: true,
    })

    const expectedBootstrapFiles = [
      DEFAULT_AGENTS_FILENAME,
      DEFAULT_SOUL_FILENAME,
      DEFAULT_TOOLS_FILENAME,
      DEFAULT_IDENTITY_FILENAME,
      DEFAULT_USER_FILENAME,
      DEFAULT_BOOTSTRAP_FILENAME,
    ]

    for (const name of expectedBootstrapFiles) {
      await expect(fs.access(path.join(tempDir, name))).resolves.toBeUndefined()
    }
    await expect(fs.access(path.join(tempDir, DEFAULT_HEARTBEAT_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("preserves an existing HEARTBEAT.md file", async () => {
    const tempDir = await makeTempWorkspace("zee-workspace-")
    await writeWorkspaceFile({
      dir: tempDir,
      name: DEFAULT_HEARTBEAT_FILENAME,
      content: "existing heartbeat content",
    })

    await ensureAgentWorkspace({
      dir: tempDir,
      ensureBootstrapFiles: true,
    })

    await expect(fs.readFile(path.join(tempDir, DEFAULT_HEARTBEAT_FILENAME), "utf-8")).resolves.toBe(
      "existing heartbeat content",
    )
  })
})
