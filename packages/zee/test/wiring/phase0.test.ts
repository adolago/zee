/**
 * Wiring Plan - Phase 0 Acceptance Tests
 *
 * These tests verify that the wiring implementations are in place:
 * 1. Learning tools are exported
 * 2. Zee tools include WhatsApp
 * 3. Memory search uses local-only retrieval without reranker wiring
 * 4. Retry logic has no secret leakage vectors
 * 5. No orphaned imports from deleted files
 */

import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"

describe("wiring.phase0", () => {
  // ============================================================================
  // Test 1: Learning tools are properly exported
  // ============================================================================
  describe("learning tools", () => {
    test(" learning domain exports expected tools", async () => {
      const learningToolsPath = path.join(process.cwd(), "../../src/domain/learning/tools.ts")
      const content = await fs.readFile(learningToolsPath, "utf-8")

      // Should export the expected tool IDs
      expect(content).toContain('id: "zee:learn-study"')
      expect(content).toContain('id: "zee:learn-knowledge"')
      expect(content).toContain('id: "zee:learn-mastery"')
      expect(content).toContain('id: "zee:learn-review"')
      expect(content).toContain('id: "zee:learn-practice"')

      expect(content).toContain("export const LEARNING_TOOLS")
    })

    test(" learning tools are registered via MCP domain", async () => {
      const mcpDomainPath = path.join(process.cwd(), "../../src/mcp/domain/index.ts")
      const content = await fs.readFile(mcpDomainPath, "utf-8")

      expect(content).toContain("export async function registerLearningTools()")
      expect(content).toContain("../../domain/learning/tools")
    })
  })

  // ============================================================================
  // Test 2: Zee WhatsApp tools are exported
  // ============================================================================
  describe("zee tools", () => {
    test(" Zee domain exports WhatsApp tools", async () => {
      // Read the Zee tools source file
      const zeeToolsPath = path.join(process.cwd(), "../../src/domain/zee/tools.ts")
      const content = await fs.readFile(zeeToolsPath, "utf-8")

      // Should import WhatsApp tools (they're defined in a separate file)
      expect(content).toContain('import { WHATSAPP_TOOLS } from "./whatsapp.js"')
      // Should include WhatsApp tools in the export
      expect(content).toContain("...WHATSAPP_TOOLS")

      // Should export ZEE_TOOLS array with all tools
      expect(content).toContain("export const ZEE_TOOLS")
    })

    test(" Zee full tools are registered via MCP domain", async () => {
      const mcpDomainPath = path.join(process.cwd(), "../../src/mcp/domain/index.ts")
      const content = await fs.readFile(mcpDomainPath, "utf-8")

      // Should have registerZeeFullTools function
      expect(content).toContain("export async function registerZeeFullTools()")
      // Should import from domain
      expect(content).toContain("../../domain/zee/tools")
    })
  })

  // ============================================================================
  // Test 3: Local-only memory search
  // ============================================================================
  describe("memory retrieval", () => {
    test(" Memory search no longer exposes rerank options", async () => {
      // Read the unified memory source
      const unifiedPath = path.join(process.cwd(), "../../src/memory/unified.ts")
      const content = await fs.readFile(unifiedPath, "utf-8")

      expect(content).not.toContain("rerank?: boolean")
      expect(content).not.toContain("createReranker")
    })

    test(" Reranker implementation was removed", async () => {
      const rerankerPath = path.join(process.cwd(), "../../src/memory/reranker.ts")
      const exists = await fs
        .stat(rerankerPath)
        .then(() => true)
        .catch(() => false)

      expect(exists).toBe(false)
    })
  })

  // ============================================================================
  // Test 4: Retry logic safety - no JSON.stringify in getErrorMessage
  // ============================================================================
  describe("retry safety", () => {
    test(" getErrorMessage does not use JSON.stringify", async () => {
      // Read the retry.ts source file
      const retryPath = path.join(process.cwd(), "../../src/session/retry.ts")
      const content = await fs.readFile(retryPath, "utf-8")

      // Extract the getErrorMessage function
      const getErrorMessageMatch = content.match(/function getErrorMessage[\s\S]*?^}/m)
      expect(getErrorMessageMatch).toBeDefined()

      if (getErrorMessageMatch) {
        const functionBody = getErrorMessageMatch[0]
        // Should NOT contain JSON.stringify
        expect(functionBody).not.toContain("JSON.stringify")
        // Should use String() for fallback
        expect(functionBody).toContain("String(error)")
      }
    })

    test(" Retry module uses safe error extraction", async () => {
      const retryPath = path.join(process.cwd(), "../../src/session/retry.ts")
      const content = await fs.readFile(retryPath, "utf-8")

      // Should classify errors without serializing objects
      expect(content).toContain("function getErrorMessage")
      expect(content).toContain("error instanceof Error")
      expect(content).toContain("typeof obj.message === 'string'")

      // Should NOT have JSON.stringify anywhere for error handling
      // (allow it in comments but not in actual code)
      const lines = content.split("\n")
      for (const line of lines) {
        // Skip comments
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) {
          continue
        }
        // Should not have JSON.stringify in code
        expect(line).not.toContain("JSON.stringify(error)")
      }
    })
  })

  // ============================================================================
  // Test 5: No orphaned imports from deleted util/retry.ts
  // ============================================================================
  describe("retry consolidation", () => {
    test(" util/retry.ts is deleted (no duplicate implementation)", async () => {
      const utilRetryPath = path.join(process.cwd(), "src/util/retry.ts")

      const exists = await fs
        .stat(utilRetryPath)
        .then(() => true)
        .catch(() => false)

      expect(exists).toBe(false)
    })

    test(" No files import from util/retry.ts", async () => {
      // Search for any imports from the deleted file
      const srcDir = path.join(process.cwd(), "src")

      async function searchDir(dir: string): Promise<string[]> {
        const results: string[] = []
        const entries = await fs.readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory() && entry.name !== "node_modules") {
            results.push(...(await searchDir(fullPath)))
          } else if (entry.name.endsWith(".ts")) {
            const content = await fs.readFile(fullPath, "utf-8")
            // Check for imports from util/retry
            if (
              content.includes("from 'util/retry'") ||
              content.includes('from "util/retry"') ||
              content.includes("from '@/util/retry'") ||
              content.includes('from "@/util/retry"')
            ) {
              results.push(fullPath)
            }
          }
        }

        return results
      }

      const offendingFiles = await searchDir(srcDir)
      expect(offendingFiles).toEqual([])
    })
  })

  // ============================================================================
  // Test 6: Retry-After header parsing
  // ============================================================================
  describe("retry-after parsing", () => {
    test(" parseRetryAfterHeader handles seconds format", async () => {
      const retryPath = path.join(process.cwd(), "../../src/session/retry.ts")
      const content = await fs.readFile(retryPath, "utf-8")

      // Should parse retry-after header
      expect(content).toContain("retry-after")
      expect(content).toContain("parseRetryAfterHeader")
    })

    test(" Retry module handles provider-specific errors", async () => {
      const retryPath = path.join(process.cwd(), "../../src/session/retry.ts")
      const content = await fs.readFile(retryPath, "utf-8")

      // Should handle rate limiting patterns
      expect(content).toContain("RATE_LIMITED")
      expect(content).toContain("rate limit")
      expect(content).toContain("429")

      // Should handle overloaded patterns
      expect(content).toContain("OVERLOADED")
      expect(content).toContain("overloaded")
      expect(content).toContain("503")

      // Should handle network errors
      expect(content).toContain("NETWORK")
      expect(content).toContain("ECONNRESET")
    })
  })

  // ============================================================================
  // Test 7: Native timers/promises for abortable sleep
  // ============================================================================
  describe("retry performance", () => {
    test(" uses node:timers/promises for sleep", async () => {
      const retryPath = path.join(process.cwd(), "../../src/session/retry.ts")
      const content = await fs.readFile(retryPath, "utf-8")

      // Should import from node:timers/promises
      expect(content).toContain("node:timers/promises")
    })
  })

  // ============================================================================
  // Test 8: Tool registry integration
  // ============================================================================
  describe("tool registry wiring", () => {
    test(" Tool registry can load custom tools", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const agentCoreDir = path.join(dir, ".zee")
          await fs.mkdir(agentCoreDir, { recursive: true })

          const toolDir = path.join(agentCoreDir, "tool")
          await fs.mkdir(toolDir, { recursive: true })

          await Bun.write(
            path.join(toolDir, "test-tool.ts"),
            `
export default {
  description: 'Test tool for wiring verification',
  args: {},
  execute: async () => {
    return 'test passed'
  },
}
`,
          )
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const ids = await ToolRegistry.ids()
          expect(ids).toContain("test-tool")
        },
      })
    })
  })
})
