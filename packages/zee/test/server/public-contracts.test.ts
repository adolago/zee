import { describe, expect, test } from "bun:test"
import path from "path"
import { SkillsRoute } from "../../src/server/route/skills"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function skill(name: string, description: string) {
  return `---
name: ${name}
description: ${description}
---

# ${name}

Instructions for ${name}.
`
}

describe("public API contracts", () => {
  test("skills APIs emit shared affinity and Zee-only context", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".agents", "skills", "@zee", "zee-skill", "SKILL.md"), skill("zee-skill", "Zee skill"))
        await Bun.write(
          path.join(dir, ".agents", "skills", "@stanley", "stan-skill", "SKILL.md"),
          skill("stan-skill", "Legacy investing skill"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await SkillsRoute.request("/v1/skills/index?agent=zee")
        expect(response.status).toBe(200)

        const body = (await response.json()) as {
          version: number
          skills: Array<{
            name: string
            affinity: string
            context?: string
          }>
        }

        expect(body.version).toBeGreaterThanOrEqual(0)
        expect(body.skills.map((item) => item.name)).toEqual(["stan-skill", "zee-skill"])
        expect(body.skills.every((item) => item.affinity === "shared")).toBeTrue()
        expect(body.skills.find((item) => item.name === "zee-skill")?.context).toBe("zee")
        expect(body.skills.find((item) => item.name === "stan-skill")?.context).toBeUndefined()
      },
    })
  })
})
