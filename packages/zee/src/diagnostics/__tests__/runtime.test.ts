/**
 * @file Runtime Checks Tests
 * @description Unit tests for runtime health checks
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import { runRuntimeChecks } from "../checks/runtime"

describe("Runtime Checks", () => {
  describe("checkBunVersion", () => {
    it("should pass when Bun version meets minimum", async () => {
      const results = await runRuntimeChecks({ full: false, fix: false, verbose: false, timeout: 5000 })
      const bunCheck = results.find((r) => r.id === "runtime.bun-version")

      expect(bunCheck).toBeDefined()
      expect(bunCheck!.status).toBe("pass")
      expect(bunCheck!.message).toContain("Bun")
    })
  })

  describe("checkDirectory", () => {
    const testDir = "/tmp/zee-test-dir-" + Date.now()

    afterEach(async () => {
      try {
        await fs.rm(testDir, { recursive: true })
      } catch {}
    })

    it("should detect missing directories and offer auto-fix", async () => {
      // Set env to use test directory
      const originalEnv = process.env.ZEE_CONFIG_DIR
      process.env.ZEE_CONFIG_DIR = testDir

      try {
        const results = await runRuntimeChecks({ full: false, fix: false, verbose: false, timeout: 5000 })
        const configDirCheck = results.find((r) => r.id === "runtime.config-dir")

        expect(configDirCheck).toBeDefined()
        expect(configDirCheck!.status).toBe("warn")
        expect(configDirCheck!.autoFixable).toBe(true)
      } finally {
        process.env.ZEE_CONFIG_DIR = originalEnv
      }
    })

    it("should pass for existing writable directories", async () => {
      await fs.mkdir(testDir, { recursive: true })
      const originalEnv = process.env.ZEE_CONFIG_DIR
      process.env.ZEE_CONFIG_DIR = testDir

      try {
        const results = await runRuntimeChecks({ full: false, fix: false, verbose: false, timeout: 5000 })
        const configDirCheck = results.find((r) => r.id === "runtime.config-dir")

        expect(configDirCheck).toBeDefined()
        expect(configDirCheck!.status).toBe("pass")
        expect(configDirCheck!.message).toContain("writable")
      } finally {
        process.env.ZEE_CONFIG_DIR = originalEnv
      }
    })
  })

  describe("checkDiskSpace", () => {
    it("should report available disk space", async () => {
      const results = await runRuntimeChecks({ full: false, fix: false, verbose: false, timeout: 5000 })
      const diskCheck = results.find((r) => r.id === "runtime.disk-space")

      expect(diskCheck).toBeDefined()
      // Should pass or skip (not fail on normal systems)
      expect(["pass", "warn", "skip"]).toContain(diskCheck!.status)
    })
  })

  describe("checkMemory", () => {
    it("should report available memory", async () => {
      const results = await runRuntimeChecks({ full: false, fix: false, verbose: false, timeout: 5000 })
      const memCheck = results.find((r) => r.id === "runtime.memory")

      expect(memCheck).toBeDefined()
      expect(memCheck!.message).toContain("MB")
      expect(memCheck!.metadata).toHaveProperty("freeMB")
      expect(memCheck!.metadata).toHaveProperty("totalMB")
    })
  })

  describe("checkOpenBBWorkspace", () => {
    it("should include the OpenBB Workspace readiness check", async () => {
      const results = await runRuntimeChecks({ full: false, fix: false, verbose: false, timeout: 5000 })
      const workspaceCheck = results.find((r) => r.id === "runtime.openbb-workspace")

      expect(workspaceCheck).toBeDefined()
      expect(["pass", "warn"]).toContain(workspaceCheck!.status)
      expect(workspaceCheck!.metadata).toHaveProperty("descriptorUrl")
    })
  })

  describe("checkBinaryMatch (extended)", () => {
    it("should only run in full mode", async () => {
      const normalResults = await runRuntimeChecks({ full: false, fix: false, verbose: false, timeout: 5000 })
      const fullResults = await runRuntimeChecks({ full: true, fix: false, verbose: false, timeout: 5000 })

      const normalBinaryCheck = normalResults.find((r) => r.id === "runtime.binary-match")
      const fullBinaryCheck = fullResults.find((r) => r.id === "runtime.binary-match")

      expect(normalBinaryCheck).toBeUndefined()
      expect(fullBinaryCheck).toBeDefined()
    })
  })
})
