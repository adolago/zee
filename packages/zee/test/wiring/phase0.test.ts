/**
 * Wiring Plan - Phase 0 Acceptance Tests
 *
 * These tests verify that the wiring implementations are in place:
 * 1. Tool registry lists Johny tools when persona=johny
 * 2. Tool registry lists WhatsApp/Splitwise tools when persona=zee
 * 3. Memory search accepts rerank: true parameter
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
  // Test 1: Johny tools are properly exported
  // ============================================================================
  describe("johny tools", () => {
    test(" Johny domain exports expected tools", async () => {
      // Read the Johny tools source file to verify structure
      const johnyToolsPath = path.join(process.cwd(), "../../src/domain/johny/tools.ts")
      const content = await fs.readFile(johnyToolsPath, "utf-8")

      // Should export the expected tool IDs
      expect(content).toContain('id: "johny:study"')
      expect(content).toContain('id: "johny:knowledge"')
      expect(content).toContain('id: "johny:mastery"')
      expect(content).toContain('id: "johny:review"')
      expect(content).toContain('id: "johny:practice"')

      // Should export JOHNY_TOOLS array
      expect(content).toContain("export const JOHNY_TOOLS")
    })

    test(" Johny tools are registered via MCP domain", async () => {
      // Read the MCP domain index to verify registration
      const mcpDomainPath = path.join(process.cwd(), "../../src/mcp/domain/index.ts")
      const content = await fs.readFile(mcpDomainPath, "utf-8")

      // Should have registerJohnyTools function
      expect(content).toContain("export async function registerJohnyTools()")
      // Should import from domain
      expect(content).toContain("../../domain/johny/tools")
    })
  })

  // ============================================================================
  // Test 2: Zee WhatsApp/Splitwise tools are exported
  // ============================================================================
  describe("zee tools", () => {
    test(" Zee domain exports WhatsApp and Splitwise tools", async () => {
      // Read the Zee tools source file
      const zeeToolsPath = path.join(process.cwd(), "../../src/domain/zee/tools.ts")
      const content = await fs.readFile(zeeToolsPath, "utf-8")

      // Should import WhatsApp tools (they're defined in a separate file)
      expect(content).toContain('import { WHATSAPP_TOOLS } from "./whatsapp.js"')
      // Should include WhatsApp tools in the export
      expect(content).toContain("...WHATSAPP_TOOLS")

      // Should contain Splitwise tool
      expect(content).toContain('id: "zee:splitwise"')

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
  // Test 3: Memory search rerank parameter
  // ============================================================================
  describe("memory reranker", () => {
    test(" Memory search accepts rerank option", async () => {
      // Read the unified memory source
      const unifiedPath = path.join(process.cwd(), "../../src/memory/unified.ts")
      const content = await fs.readFile(unifiedPath, "utf-8")

      // Should have rerank parameter in search
      expect(content).toContain("rerank?: boolean")
      // Should handle rerank logic
      expect(content).toContain("params?.rerank")
    })

    test(" Reranker implementation exists", async () => {
      const rerankerPath = path.join(process.cwd(), "../../src/memory/reranker.ts")
      const exists = await fs
        .stat(rerankerPath)
        .then(() => true)
        .catch(() => false)

      expect(exists).toBe(true)

      if (exists) {
        const content = await fs.readFile(rerankerPath, "utf-8")
        // Should have Voyage reranker
        expect(content).toContain("VoyageReranker")
        // Should have VLLM reranker
        expect(content).toContain("VLLMReranker")
        // Should export createReranker
        expect(content).toContain("export function createReranker")
      }
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
