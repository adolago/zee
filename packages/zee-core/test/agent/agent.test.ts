import { describe, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { PermissionNext } from "../../src/permission/next"

// Helper to evaluate permission for a tool with wildcard pattern
function evalPerm(agent: Agent.Info | undefined, permission: string): PermissionNext.Action | undefined {
  if (!agent) return undefined
  return PermissionNext.evaluate(permission, "*", agent.permission).action
}

// NOTE: agent-core uses Personas (zee, stanley, johny) instead of generic agents (build, plan, etc.)
// These tests have been updated to reflect the personas architecture.

describe("agent config", () => {
test("returns default persona agents when no config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      // Personas agents
      expect(names).toContain("zee")
      expect(names).toContain("stanley")
      expect(names).toContain("johny")
      // Utility agents
      expect(names).toContain("compaction")
      expect(names).toContain("title")
      expect(names).toContain("summary")
    },
  })
})

test("zee agent has correct default properties", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(zee).toBeDefined()
      expect(zee?.native).toBe(true)
      expect(evalPerm(zee, "edit")).toBe("allow")
      expect(evalPerm(zee, "bash")).toBe("allow")
    },
  })
})

test("zee agent starts the calendar mcp server", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      const servers = zee?.mcpServers ?? []
      expect(servers).toContain("calendar")
      expect(servers).not.toContain("google-calendar")
    },
  })
})

test("stanley agent has correct default properties", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const stanley = await Agent.get("stanley")
      expect(stanley).toBeDefined()
      expect(stanley?.native).toBe(true)
    },
  })
})

test("johny agent has correct default properties", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const johny = await Agent.get("johny")
      expect(johny).toBeDefined()
      expect(johny?.native).toBe(true)
    },
  })
})

test("compaction agent denies all permissions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const compaction = await Agent.get("compaction")
      expect(compaction).toBeDefined()
      expect(compaction?.hidden).toBe(true)
      expect(evalPerm(compaction, "bash")).toBe("deny")
      expect(evalPerm(compaction, "edit")).toBe("deny")
      expect(evalPerm(compaction, "read")).toBe("deny")
    },
  })
})

test("custom agent from config creates new agent", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        my_custom_agent: {
          model: "openai/gpt-4",
          description: "My custom agent",
          temperature: 0.5,
          top_p: 0.9,
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const custom = await Agent.get("my_custom_agent")
      expect(custom).toBeDefined()
      expect(custom?.model?.providerID).toBe("openai")
      expect(custom?.model?.modelID).toBe("gpt-4")
      expect(custom?.description).toBe("My custom agent")
      expect(custom?.temperature).toBe(0.5)
      expect(custom?.topP).toBe(0.9)
      expect(custom?.native).toBe(false)
      expect(custom?.mode).toBe("all")
    },
  })
})

test("custom agent config overrides native agent properties", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        zee: {
          model: "anthropic/claude-3",
          description: "Custom zee agent",
          temperature: 0.7,
          color: "#FF0000",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(zee).toBeDefined()
      expect(zee?.model?.providerID).toBe("anthropic")
      expect(zee?.model?.modelID).toBe("claude-3")
      expect(zee?.description).toBe("Custom zee agent")
      expect(zee?.temperature).toBe(0.7)
      expect(zee?.color).toBe("#FF0000")
      expect(zee?.native).toBe(true)
    },
  })
})

test("agent disable removes agent from list", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        stanley: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const stanley = await Agent.get("stanley")
      expect(stanley).toBeUndefined()
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).not.toContain("stanley")
    },
  })
})

test("agent permission config merges with defaults", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        zee: {
          permission: {
            bash: {
              "rm -rf *": "deny",
            },
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(zee).toBeDefined()
      // Specific pattern is denied
      expect(PermissionNext.evaluate("bash", "rm -rf *", zee!.permission).action).toBe("deny")
      // Edit still allowed
      expect(evalPerm(zee, "edit")).toBe("allow")
    },
  })
})

test("global permission config applies to all agents", async () => {
  await using tmp = await tmpdir({
    config: {
      permission: {
        bash: "deny",
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(zee).toBeDefined()
      expect(evalPerm(zee, "bash")).toBe("deny")
    },
  })
})

test("agent steps/maxSteps config sets steps property", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        zee: { steps: 50 },
        stanley: { maxSteps: 100 },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      const stanley = await Agent.get("stanley")
      expect(zee?.steps).toBe(50)
      expect(stanley?.steps).toBe(100)
    },
  })
})

test("agent mode can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        johny: { mode: "subagent" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const johny = await Agent.get("johny")
      expect(johny?.mode).toBe("subagent")
    },
  })
})

test("agent name can be overridden", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        zee: { name: "Personal Assistant" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(zee?.name).toBe("Personal Assistant")
    },
  })
})

test("agent prompt can be set from config", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        zee: { prompt: "Custom system prompt" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(zee?.prompt).toBe("Custom system prompt")
    },
  })
})

test("unknown agent properties are placed into options", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        zee: {
          random_property: "hello",
          another_random: 123,
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(zee?.options.random_property).toBe("hello")
      expect(zee?.options.another_random).toBe(123)
    },
  })
})

test("agent options merge correctly", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        zee: {
          options: {
            custom_option: true,
            another_option: "value",
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(zee?.options.custom_option).toBe(true)
      expect(zee?.options.another_option).toBe("value")
    },
  })
})

test("multiple custom agents can be defined", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        agent_a: {
          description: "Agent A",
          mode: "subagent",
        },
        agent_b: {
          description: "Agent B",
          mode: "primary",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agentA = await Agent.get("agent_a")
      const agentB = await Agent.get("agent_b")
      expect(agentA?.description).toBe("Agent A")
      expect(agentA?.mode).toBe("subagent")
      expect(agentB?.description).toBe("Agent B")
      expect(agentB?.mode).toBe("primary")
    },
  })
})

test("Agent.get returns undefined for non-existent agent", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const nonExistent = await Agent.get("does_not_exist")
      expect(nonExistent).toBeUndefined()
    },
  })
})

test("default permission includes doom_loop and external_directory as ask", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(evalPerm(zee, "doom_loop")).toBe("ask")
      expect(evalPerm(zee, "external_directory")).toBe("ask")
    },
  })
})

test("webfetch is allowed by default", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(evalPerm(zee, "webfetch")).toBe("allow")
    },
  })
})

test("legacy tools config converts to permissions", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        zee: {
          tools: {
            bash: false,
            read: false,
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(evalPerm(zee, "bash")).toBe("deny")
      expect(evalPerm(zee, "read")).toBe("deny")
    },
  })
})

test("legacy tools config maps write/edit/patch/multiedit to edit permission", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        zee: {
          tools: {
            write: false,
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(evalPerm(zee, "edit")).toBe("deny")
    },
  })
})

test("Truncate.DIR is allowed when user denies external_directory globally", async () => {
  const { Truncate } = await import("../../src/tool/truncation")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: "deny",
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, zee!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("external_directory", Truncate.GLOB, zee!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("external_directory", "/some/other/path", zee!.permission).action).toBe("deny")
    },
  })
})

test("Truncate.DIR is allowed when user denies external_directory per-agent", async () => {
  const { Truncate } = await import("../../src/tool/truncation")
  await using tmp = await tmpdir({
    config: {
      agent: {
        zee: {
          permission: {
            external_directory: "deny",
          },
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, zee!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("external_directory", Truncate.GLOB, zee!.permission).action).toBe("allow")
      expect(PermissionNext.evaluate("external_directory", "/some/other/path", zee!.permission).action).toBe("deny")
    },
  })
})

test("explicit Truncate.DIR deny is respected", async () => {
  const { Truncate } = await import("../../src/tool/truncation")
  await using tmp = await tmpdir({
    config: {
      permission: {
        external_directory: {
          "*": "deny",
          [Truncate.DIR]: "deny",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const zee = await Agent.get("zee")
      expect(PermissionNext.evaluate("external_directory", Truncate.DIR, zee!.permission).action).toBe("deny")
      expect(PermissionNext.evaluate("external_directory", Truncate.GLOB, zee!.permission).action).toBe("deny")
    },
  })
})

test("defaultAgent returns zee when no default_agent config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      expect(agent).toBe("zee")
    },
  })
})

test("defaultAgent respects default_agent config set to zee", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "zee",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      expect(agent).toBe("zee")
    },
  })
})

test("defaultAgent throws when default_agent points to non-persona", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "my_custom",
      agent: {
        my_custom: {
          description: "My custom agent",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow("must be a persona")
    },
  })
})

test("defaultAgent throws when default_agent points to subagent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "helper",
      agent: {
        helper: {
          mode: "subagent",
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow('default agent "helper" is a subagent')
    },
  })
})

test("defaultAgent throws when default_agent points to hidden agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "compaction",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow('default agent "compaction" is hidden')
    },
  })
})

test("defaultAgent throws when default_agent points to non-existent agent", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "does_not_exist",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow('default agent "does_not_exist" not found')
    },
  })
})

test("defaultAgent returns zee when stanley is disabled and default_agent not set", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        stanley: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Agent.defaultAgent()
      expect(agent).toBe("zee")
    },
  })
})

test("defaultAgent throws when all primary agents are disabled", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        stanley: { disable: true },
        zee: { disable: true },
        johny: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Agent.defaultAgent()).rejects.toThrow('default agent "zee" not found')
    },
  })
})
})
