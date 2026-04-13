import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { syncBundledSkillsToMachine } from "../../src/skill/mirror"
import { tmpdir } from "../fixture/fixture"

test("bundled skill mirror skips and prunes duplicates when source checkout skills are present", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.mkdir(path.join(dir, ".zee", "skill", "@zee", "demo"), { recursive: true })
      await fs.mkdir(path.join(dir, ".agents", "skills", "@zee"), { recursive: true })
      await fs.mkdir(path.join(dir, "config", "skills", "@zee", "demo"), { recursive: true })
      await Bun.write(path.join(dir, ".agents", "skills", "@zee", "SKILL.md"), "# source checkout\n")
      await Bun.write(path.join(dir, ".zee", "skill", "@zee", "demo", "SKILL.md"), "# bundled copy\n")
      await Bun.write(
        path.join(dir, ".zee", "skill-manifest.json"),
        JSON.stringify({
          version: 1,
          generatedAt: new Date().toISOString(),
          skills: [
            {
              id: "demo",
              path: "@zee/demo",
              context: "zee",
              title: "Demo",
              description: "Demo skill",
              curated: true,
            },
          ],
        }),
      )
      await Bun.write(path.join(dir, "config", "skills", "@zee", "demo", "SKILL.md"), "# mirrored copy\n")
      await Bun.write(
        path.join(dir, "config", "skill-mirror-state.json"),
        JSON.stringify({
          version: 1,
          manifestHash: "old",
          mirroredAt: new Date().toISOString(),
          sourceRoot: path.join(dir, ".zee", "skill"),
          destinationRoot: path.join(dir, "config", "skills"),
          skillCount: 1,
        }),
      )
    },
  })

  const original = {
    ZEE_SOURCE: process.env.ZEE_SOURCE,
    ZEE_CONFIG_DIR: process.env.ZEE_CONFIG_DIR,
  }
  const previousCwd = process.cwd()

  process.env.ZEE_SOURCE = tmp.path
  process.env.ZEE_CONFIG_DIR = path.join(tmp.path, "config")
  process.chdir(tmp.path)

  try {
    const result = await syncBundledSkillsToMachine({ reason: "test" })
    expect(result.status).toBe("skipped")
    expect(result.reason).toBe("source-checkout-skills-present")
    expect(await Bun.file(path.join(tmp.path, "config", "skills", "@zee", "demo", "SKILL.md")).exists()).toBe(false)
    expect(await Bun.file(path.join(tmp.path, "config", "skill-mirror-state.json")).exists()).toBe(false)
  } finally {
    process.chdir(previousCwd)
    if (original.ZEE_SOURCE === undefined) delete process.env.ZEE_SOURCE
    else process.env.ZEE_SOURCE = original.ZEE_SOURCE

    if (original.ZEE_CONFIG_DIR === undefined) delete process.env.ZEE_CONFIG_DIR
    else process.env.ZEE_CONFIG_DIR = original.ZEE_CONFIG_DIR
  }
})
