import { describe, expect, test, beforeEach } from "bun:test"
import { HoldMode } from "../../src/config/hold-mode"
import { Instance } from "../../src/project/instance"
import { resolveConfigDir } from "../../src/global/dirs"
import { tmpdir } from "../fixture/fixture"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("HoldMode.matchesPattern", () => {
  test("matches exact commands", () => {
    expect(HoldMode.matchesPattern("rm -rf /", ["rm -rf /"])).toBe(true)
    expect(HoldMode.matchesPattern("rm -rf /home", ["rm -rf /"])).toBe(false)
  })

  test("matches command prefixes", () => {
    expect(HoldMode.matchesPattern("docker build .", ["docker build"])).toBe(true)
    expect(HoldMode.matchesPattern("docker run", ["docker build"])).toBe(false)
  })

  test("matches wildcards", () => {
    expect(HoldMode.matchesPattern("npm test", ["npm *"])).toBe(true)
    expect(HoldMode.matchesPattern("npm run build", ["npm *"])).toBe(true)
    expect(HoldMode.matchesPattern("yarn test", ["npm *"])).toBe(false)
  })

  test("is case insensitive", () => {
    expect(HoldMode.matchesPattern("Docker Build", ["docker build"])).toBe(true)
    expect(HoldMode.matchesPattern("docker build", ["Docker Build"])).toBe(true)
  })

  test("returns false for empty patterns", () => {
    expect(HoldMode.matchesPattern("any command", [])).toBe(false)
  })
})

describe("HoldMode.skipPermissions bypass", () => {
    beforeEach(() => {
      HoldMode.invalidateCache()
    })

    test("skipPermissions bypasses always_block in hold mode", async () => {
      await withTempConfig({ always_block: ["dangerous-cmd"] }, async () => {
        const result = await HoldMode.checkCommand("dangerous-cmd --flag", { 
          holdMode: true,
          skipPermissions: true 
        })
        expect(result.blocked).toBe(false)
        expect(result.skipPermissions).toBe(true)
      })
    })

    test("skipPermissions bypasses always_block in release mode", async () => {
      await withTempConfig({ always_block: ["dangerous-cmd"] }, async () => {
        const result = await HoldMode.checkCommand("dangerous-cmd --flag", { 
          holdMode: false,
          skipPermissions: true 
        })
        expect(result.blocked).toBe(false)
        expect(result.skipPermissions).toBe(true)
      })
    })

    test("skipPermissions bypasses release_confirm in release mode", async () => {
      await withTempConfig({ release_confirm: ["confirm-cmd"] }, async () => {
        const result = await HoldMode.checkCommand("confirm-cmd --arg", { 
          holdMode: false,
          skipPermissions: true 
        })
        expect(result.blocked).toBe(false)
        expect(result.requiresConfirmation).toBeUndefined()
        expect(result.skipPermissions).toBe(true)
      })
    })

    test("skipPermissions allows tools in hold mode", async () => {
      const allowed = await HoldMode.isToolAllowedInHold("edit", true)
      expect(allowed).toBe(true)
    })

    test("skipPermissions allows write in hold mode", async () => {
      const allowed = await HoldMode.isToolAllowedInHold("write", true)
      expect(allowed).toBe(true)
    })

    test("skipPermissions allows apply_patch in hold mode", async () => {
      const allowed = await HoldMode.isToolAllowedInHold("apply_patch", true)
      expect(allowed).toBe(true)
    })

    test("skipPermissions allows todowrite in hold mode", async () => {
      const allowed = await HoldMode.isToolAllowedInHold("todowrite", true)
      expect(allowed).toBe(true)
    })

    test("skipPermissions false still respects hold mode restrictions", async () => {
      await withTempConfig({}, async () => {
        const allowed = await HoldMode.isToolAllowedInHold("edit", false)
        expect(allowed).toBe(false)
      })
    })

    test("skipPermissions false still respects hold mode command blocks", async () => {
      await withTempConfig({ always_block: ["dangerous-cmd"] }, async () => {
        const result = await HoldMode.checkCommand("dangerous-cmd --flag", { 
          holdMode: true,
          skipPermissions: false 
        })
        expect(result.blocked).toBe(true)
        expect(result.skipPermissions).toBeUndefined()
      })
    })

    test("skipPermissions true still blocks always_block when holdMode is false", async () => {
      await withTempConfig({ always_block: ["dangerous-cmd"] }, async () => {
        const result = await HoldMode.checkCommand("dangerous-cmd --flag", { 
          holdMode: false,
          skipPermissions: true 
        })
        expect(result.blocked).toBe(false)
        expect(result.skipPermissions).toBe(true)
      })
    })
})

describe("HoldMode.findMatchingPattern", () => {
  test("returns the matched pattern for command prefixes", () => {
    expect(HoldMode.findMatchingPattern("docker build .", ["docker build"])).toBe("docker build")
    expect(HoldMode.findMatchingPattern("docker run", ["docker build"])).toBeNull()
  })

  test("returns the matched pattern for wildcards", () => {
    expect(HoldMode.findMatchingPattern("npm test", ["npm *"])).toBe("npm *")
    expect(HoldMode.findMatchingPattern("npm run build", ["npm *"])).toBe("npm *")
    expect(HoldMode.findMatchingPattern("yarn test", ["npm *"])).toBeNull()
  })

  test("preserves original pattern case in return value", () => {
    expect(HoldMode.findMatchingPattern("docker build", ["Docker Build"])).toBe("Docker Build")
    expect(HoldMode.findMatchingPattern("NPM TEST", ["npm *"])).toBe("npm *")
  })

  test("returns null for empty patterns", () => {
    expect(HoldMode.findMatchingPattern("any command", [])).toBeNull()
  })

  test("returns first matching pattern when multiple match", () => {
    expect(HoldMode.findMatchingPattern("npm test", ["npm *", "npm test"])).toBe("npm *")
  })
})

describe("HoldMode.getEffectiveBlocklist", () => {
  test("normal profile includes standard blocklist", async () => {
    const blocklist = await HoldMode.getEffectiveBlocklist("normal")
    expect(blocklist.has("rm")).toBe(true)
    expect(blocklist.has("kill")).toBe(true)
    expect(blocklist.has("systemctl")).toBe(true)
  })

  test("strict profile adds interpreters and network tools", async () => {
    const blocklist = await HoldMode.getEffectiveBlocklist("strict")
    expect(blocklist.has("python")).toBe(true)
    expect(blocklist.has("node")).toBe(true)
    expect(blocklist.has("curl")).toBe(true)
    expect(blocklist.has("ssh")).toBe(true)
    expect(blocklist.has("docker")).toBe(true)
  })

  test("permissive profile removes touch and mkdir", async () => {
    const blocklist = await HoldMode.getEffectiveBlocklist("permissive")
    expect(blocklist.has("touch")).toBe(false)
    expect(blocklist.has("mkdir")).toBe(false)
    expect(blocklist.has("rm")).toBe(true)
  })
})

describe("HoldMode.ConfigSchema", () => {
  test("provides defaults for missing fields", () => {
    const result = HoldMode.ConfigSchema.parse({})
    expect(result.profile).toBe("normal")
    expect(result.always_block).toEqual([])
    expect(result.hold_allow).toEqual([])
    expect(result.release_confirm).toEqual([])
    expect(result.tools).toEqual({})
  })

  test("accepts valid profiles", () => {
    expect(HoldMode.ConfigSchema.parse({ profile: "strict" }).profile).toBe("strict")
    expect(HoldMode.ConfigSchema.parse({ profile: "normal" }).profile).toBe("normal")
    expect(HoldMode.ConfigSchema.parse({ profile: "permissive" }).profile).toBe("permissive")
  })

  test("rejects invalid profiles", () => {
    expect(() => HoldMode.ConfigSchema.parse({ profile: "invalid" })).toThrow()
  })
})

// Helper to create a temporary config directory for testing
// Also sets up an Instance context since HoldMode.load() requires Instance.directory
async function withTempConfig(
  config: Partial<HoldMode.Config>,
  fn: () => Promise<void>
): Promise<void> {
  // Create temp directory for project (needed for Instance context)
  await using projectDir = await tmpdir({ git: true })

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hold-mode-test-"))

  const originalXdgConfig = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = tempDir
  HoldMode.invalidateCache()

  try {
    const configDir = resolveConfigDir()
    await fs.mkdir(configDir, { recursive: true })
    const configPath = path.join(configDir, "hold-mode.yaml")

    // Write config as YAML
    const yamlContent = Object.entries(config)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          if (value.length === 0) return `${key}: []`
          return `${key}:\n${value.map((v) => `  - "${v}"`).join("\n")}`
        }
        if (typeof value === "object" && value !== null) {
          const entries = Object.entries(value)
          if (entries.length === 0) return `${key}: {}`
          return `${key}:\n${entries.map(([k, v]) => `  ${k}: ${v}`).join("\n")}`
        }
        return `${key}: ${value}`
      })
      .join("\n")

    await fs.writeFile(configPath, yamlContent)

    await Instance.provide({
      directory: projectDir.path,
      fn: async () => {
        await fn()
      },
    })
  } finally {
    process.env.XDG_CONFIG_HOME = originalXdgConfig
    HoldMode.invalidateCache()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

describe("HoldMode.isToolAllowedInHold", () => {
  beforeEach(() => {
    HoldMode.invalidateCache()
  })

  test("returns false by default for unconfigured tools", async () => {
    await withTempConfig({}, async () => {
      expect(await HoldMode.isToolAllowedInHold("edit")).toBe(false)
      expect(await HoldMode.isToolAllowedInHold("write")).toBe(false)
      expect(await HoldMode.isToolAllowedInHold("apply_patch")).toBe(false)
      expect(await HoldMode.isToolAllowedInHold("todowrite")).toBe(false)
    })
  })

  test("returns true when tools.edit: true is set", async () => {
    await withTempConfig({ tools: { edit: true } }, async () => {
      expect(await HoldMode.isToolAllowedInHold("edit")).toBe(true)
    })
  })

  test("returns false when tools.edit: false is set", async () => {
    await withTempConfig({ tools: { edit: false } }, async () => {
      expect(await HoldMode.isToolAllowedInHold("edit")).toBe(false)
    })
  })

  test("works for all four tool types", async () => {
    await withTempConfig({
      tools: { edit: true, write: true, apply_patch: true, todowrite: true }
    }, async () => {
      expect(await HoldMode.isToolAllowedInHold("edit")).toBe(true)
      expect(await HoldMode.isToolAllowedInHold("write")).toBe(true)
      expect(await HoldMode.isToolAllowedInHold("apply_patch")).toBe(true)
      expect(await HoldMode.isToolAllowedInHold("todowrite")).toBe(true)
    })
  })

  test("handles mixed tool settings", async () => {
    await withTempConfig({
      tools: { edit: true, write: false }
    }, async () => {
      expect(await HoldMode.isToolAllowedInHold("edit")).toBe(true)
      expect(await HoldMode.isToolAllowedInHold("write")).toBe(false)
      // Unconfigured tools default to false
      expect(await HoldMode.isToolAllowedInHold("apply_patch")).toBe(false)
      expect(await HoldMode.isToolAllowedInHold("todowrite")).toBe(false)
    })
  })
})

describe("HoldMode.checkCommand", () => {
  beforeEach(() => {
    HoldMode.invalidateCache()
  })

  test("always_block patterns block in hold mode", async () => {
    await withTempConfig({ always_block: ["dangerous-cmd"] }, async () => {
      const result = await HoldMode.checkCommand("dangerous-cmd --flag", { holdMode: true })
      expect(result.blocked).toBe(true)
      expect(result.reason).toBe("command in always_block list")
      expect(result.matchedPattern).toBe("dangerous-cmd")
    })
  })

  test("always_block patterns block in release mode", async () => {
    await withTempConfig({ always_block: ["dangerous-cmd"] }, async () => {
      const result = await HoldMode.checkCommand("dangerous-cmd --flag", { holdMode: false })
      expect(result.blocked).toBe(true)
      expect(result.reason).toBe("command in always_block list")
      expect(result.matchedPattern).toBe("dangerous-cmd")
    })
  })

  test("hold_allow patterns bypass blocklist in hold mode", async () => {
    await withTempConfig({ hold_allow: ["safe-cmd"] }, async () => {
      const result = await HoldMode.checkCommand("safe-cmd --arg", { holdMode: true })
      expect(result.blocked).toBe(false)
    })
  })

  test("hold_allow does NOT bypass always_block", async () => {
    await withTempConfig({
      always_block: ["blocked-cmd"],
      hold_allow: ["blocked-cmd"]
    }, async () => {
      const result = await HoldMode.checkCommand("blocked-cmd", { holdMode: true })
      expect(result.blocked).toBe(true)
      expect(result.reason).toBe("command in always_block list")
    })
  })

  test("release_confirm returns requiresConfirmation: true in release mode", async () => {
    await withTempConfig({ release_confirm: ["confirm-cmd"] }, async () => {
      const result = await HoldMode.checkCommand("confirm-cmd --arg", { holdMode: false })
      expect(result.blocked).toBe(false)
      expect(result.requiresConfirmation).toBe(true)
      expect(result.matchedPattern).toBe("confirm-cmd")
    })
  })

  test("release_confirm does NOT trigger in hold mode", async () => {
    await withTempConfig({ release_confirm: ["confirm-cmd"] }, async () => {
      const result = await HoldMode.checkCommand("confirm-cmd --arg", { holdMode: true })
      expect(result.blocked).toBe(false)
      expect(result.requiresConfirmation).toBeUndefined()
    })
  })

  test("commands not matching any pattern are allowed", async () => {
    await withTempConfig({
      always_block: ["blocked"],
      hold_allow: ["allowed"],
      release_confirm: ["confirm"]
    }, async () => {
      const result = await HoldMode.checkCommand("some-other-cmd", { holdMode: false })
      expect(result.blocked).toBe(false)
      expect(result.requiresConfirmation).toBeUndefined()
    })
  })

  test("wildcard patterns work in always_block", async () => {
    await withTempConfig({ always_block: ["danger*"] }, async () => {
      const result = await HoldMode.checkCommand("dangerous-operation", { holdMode: false })
      expect(result.blocked).toBe(true)
    })
  })

  test("wildcard patterns work in hold_allow", async () => {
    await withTempConfig({ hold_allow: ["safe*"] }, async () => {
      const result = await HoldMode.checkCommand("safe-anything", { holdMode: true })
      expect(result.blocked).toBe(false)
    })
  })

  test("wildcard patterns work in release_confirm", async () => {
    await withTempConfig({ release_confirm: ["deploy*"] }, async () => {
      const result = await HoldMode.checkCommand("deploy-production", { holdMode: false })
      expect(result.blocked).toBe(false)
      expect(result.requiresConfirmation).toBe(true)
      expect(result.matchedPattern).toBe("deploy*")
    })
  })

  test("case insensitivity works for always_block", async () => {
    await withTempConfig({ always_block: ["Dangerous-Cmd"] }, async () => {
      const result = await HoldMode.checkCommand("dangerous-cmd", { holdMode: false })
      expect(result.blocked).toBe(true)
    })
  })

  test("case insensitivity works for hold_allow", async () => {
    await withTempConfig({ hold_allow: ["Safe-Cmd"] }, async () => {
      const result = await HoldMode.checkCommand("safe-cmd", { holdMode: true })
      expect(result.blocked).toBe(false)
    })
  })

  test("case insensitivity works for release_confirm", async () => {
    await withTempConfig({ release_confirm: ["Confirm-Cmd"] }, async () => {
      const result = await HoldMode.checkCommand("confirm-cmd", { holdMode: false })
      expect(result.requiresConfirmation).toBe(true)
      expect(result.matchedPattern).toBe("Confirm-Cmd")
    })
  })
})

describe("HoldMode.checkCommand edge cases", () => {
  beforeEach(() => {
    HoldMode.invalidateCache()
  })

  test("empty command string is allowed", async () => {
    await withTempConfig({ always_block: ["rm"] }, async () => {
      const result = await HoldMode.checkCommand("", { holdMode: false })
      expect(result.blocked).toBe(false)
    })
  })

  test("command with only whitespace is allowed", async () => {
    await withTempConfig({ always_block: ["rm"] }, async () => {
      const result = await HoldMode.checkCommand("   ", { holdMode: false })
      expect(result.blocked).toBe(false)
    })
  })

  test("command with shell metacharacters is checked correctly", async () => {
    await withTempConfig({ always_block: ["rm"] }, async () => {
      // rm command at start should be blocked
      const result1 = await HoldMode.checkCommand("rm -rf /tmp/test", { holdMode: false })
      expect(result1.blocked).toBe(true)

      // echo command containing "rm" in string should NOT be blocked
      const result2 = await HoldMode.checkCommand("echo 'rm is dangerous'", { holdMode: false })
      expect(result2.blocked).toBe(false)
    })
  })

  test("command with pipes is checked on first command only", async () => {
    await withTempConfig({ always_block: ["cat"] }, async () => {
      // The blocklist checks the full command string, so "cat" at start matches
      const result = await HoldMode.checkCommand("cat file.txt | grep pattern", { holdMode: false })
      expect(result.blocked).toBe(true)
    })
  })

  test("command with semicolons is not split - pattern needs exact match or space after", async () => {
    await withTempConfig({ always_block: ["ls"] }, async () => {
      // "ls;" does not match "ls" pattern (not exact, no space after "ls")
      const result1 = await HoldMode.checkCommand("ls; rm -rf /", { holdMode: false })
      expect(result1.blocked).toBe(false)

      // "ls -la" matches "ls" pattern (space after "ls")
      const result2 = await HoldMode.checkCommand("ls -la; rm -rf /", { holdMode: false })
      expect(result2.blocked).toBe(true)
    })
  })

  test("command with leading whitespace is trimmed", async () => {
    await withTempConfig({ always_block: ["rm"] }, async () => {
      const result = await HoldMode.checkCommand("  rm -rf /tmp", { holdMode: false })
      expect(result.blocked).toBe(true)
    })
  })

  test("multiple patterns in always_block all work", async () => {
    await withTempConfig({ always_block: ["rm", "kill", "shutdown"] }, async () => {
      expect((await HoldMode.checkCommand("rm file", { holdMode: false })).blocked).toBe(true)
      expect((await HoldMode.checkCommand("kill -9 1234", { holdMode: false })).blocked).toBe(true)
      expect((await HoldMode.checkCommand("shutdown now", { holdMode: false })).blocked).toBe(true)
      expect((await HoldMode.checkCommand("echo hello", { holdMode: false })).blocked).toBe(false)
    })
  })

  test("order of precedence: always_block checked before hold_allow", async () => {
    // This demonstrates that always_block takes precedence
    await withTempConfig({
      always_block: ["rm"],
      hold_allow: ["rm"]
    }, async () => {
      // Even with hold_allow, always_block should win
      const result = await HoldMode.checkCommand("rm file", { holdMode: true })
      expect(result.blocked).toBe(true)
    })
  })
})

  describe("HoldMode.skipPermissions bypass", () => {
    beforeEach(() => {
      HoldMode.invalidateCache()
    })

    test("skipPermissions bypasses always_block in hold mode", async () => {
      await withTempConfig({ always_block: ["dangerous-cmd"] }, async () => {
        const result = await HoldMode.checkCommand("dangerous-cmd --flag", { 
          holdMode: true,
          skipPermissions: true 
        })
        expect(result.blocked).toBe(false)
        expect(result.skipPermissions).toBe(true)
      })
    })

    test("skipPermissions bypasses always_block in release mode", async () => {
      await withTempConfig({ always_block: ["dangerous-cmd"] }, async () => {
        const result = await HoldMode.checkCommand("dangerous-cmd --flag", { 
          holdMode: false,
          skipPermissions: true 
        })
        expect(result.blocked).toBe(false)
        expect(result.skipPermissions).toBe(true)
      })
    })

    test("skipPermissions bypasses release_confirm in release mode", async () => {
      await withTempConfig({ release_confirm: ["confirm-cmd"] }, async () => {
        const result = await HoldMode.checkCommand("confirm-cmd --arg", { 
          holdMode: false,
          skipPermissions: true 
        })
        expect(result.blocked).toBe(false)
        expect(result.requiresConfirmation).toBeUndefined()
        expect(result.skipPermissions).toBe(true)
      })
    })

    test("skipPermissions allows tools in hold mode", async () => {
      const allowed = await HoldMode.isToolAllowedInHold("edit", true)
      expect(allowed).toBe(true)
    })

    test("skipPermissions allows write in hold mode", async () => {
      const allowed = await HoldMode.isToolAllowedInHold("write", true)
      expect(allowed).toBe(true)
    })

    test("skipPermissions allows apply_patch in hold mode", async () => {
      const allowed = await HoldMode.isToolAllowedInHold("apply_patch", true)
      expect(allowed).toBe(true)
    })

    test("skipPermissions allows todowrite in hold mode", async () => {
      const allowed = await HoldMode.isToolAllowedInHold("todowrite", true)
      expect(allowed).toBe(true)
    })

    test("skipPermissions false still respects hold mode restrictions", async () => {
      await withTempConfig({}, async () => {
        const allowed = await HoldMode.isToolAllowedInHold("edit", false)
        expect(allowed).toBe(false)
      })
    })

    test("skipPermissions false still respects hold mode command blocks", async () => {
      await withTempConfig({ always_block: ["dangerous-cmd"] }, async () => {
        const result = await HoldMode.checkCommand("dangerous-cmd --flag", { 
          holdMode: true,
          skipPermissions: false 
        })
        expect(result.blocked).toBe(true)
        expect(result.skipPermissions).toBeUndefined()
      })
    })

    test("skipPermissions true still blocks always_block when holdMode is false", async () => {
      await withTempConfig({ always_block: ["dangerous-cmd"] }, async () => {
        const result = await HoldMode.checkCommand("dangerous-cmd --flag", { 
          holdMode: false,
          skipPermissions: true 
        })
        expect(result.blocked).toBe(false)
        expect(result.skipPermissions).toBe(true)
      })
    })
  })
