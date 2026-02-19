import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { PermissionNext } from "../../src/permission/next"
import { Instance } from "../../src/project/instance"
import { buildSkillRecallContext } from "../../src/session/skill-recall"
import type { MessageV2 } from "../../src/session/message-v2"
import { tmpdir } from "../fixture/fixture"

const agentPermission = PermissionNext.fromConfig({
  "*": "allow",
  skill: { "*": "allow" },
})

function makeAgent() {
  return {
    name: "zee",
    mode: "primary",
    permission: agentPermission,
    options: {},
  } as any
}

function userMessage(text: string): MessageV2.WithParts {
  return {
    info: {
      id: "msg_user_1",
      role: "user",
    },
    parts: [{ type: "text", text }],
  } as any
}

describe("session.skill-recall", () => {
  test("returns undefined when there is no user query text", async () => {
    const result = await buildSkillRecallContext({
      agent: makeAgent(),
      messages: [] as any,
    })

    expect(result).toBeUndefined()
  })

  test("recommends and auto-loads the top skill for high-confidence intent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const haDir = path.join(dir, ".agents", "skills", "@zee", "home-assistant")
        const calDir = path.join(dir, ".agents", "skills", "@zee", "calendar")
        await fs.mkdir(haDir, { recursive: true })
        await fs.mkdir(calDir, { recursive: true })

        await Bun.write(
          path.join(haDir, "SKILL.md"),
          [
            "---",
            "name: home-assistant",
            "description: Control smart home lights, scenes, and automations.",
            "triggers:",
            "  - set office lights to 2200k at 50%",
            "  - set office lights",
            "---",
            "",
            "# Home Assistant",
            "",
            "Use Home Assistant API calls to control smart-home entities.",
            "",
          ].join("\n"),
        )

        await Bun.write(
          path.join(calDir, "SKILL.md"),
          [
            "---",
            "name: calendar",
            "description: Manage calendar events and schedules.",
            "---",
            "",
            "# Calendar",
            "",
            "Use this for meeting workflows.",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await buildSkillRecallContext({
          agent: makeAgent(),
          messages: [userMessage("set office lights to 2200k at 50%")],
        })

        expect(result).toBeDefined()
        expect(result!).toContain("## Recommended Skills For This Turn")
        expect(result!).toContain("home-assistant")
        expect(result!).toContain("### Auto-loaded Skill: home-assistant")
        expect(result!).toContain("# Home Assistant")
      },
    })
  })
})
