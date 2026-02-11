import { test, expect, describe } from "bun:test"
import { Skill } from "../../src/skill"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

function skill(name: string, description: string, extra = "") {
  return `---
name: ${name}
description: ${description}
${extra}---

# ${name}

Instructions for ${name}.
`
}

describe("Skill.audit()", () => {
  test("reports loaded skills with correct counts", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const name of ["alpha", "beta"]) {
          await Bun.write(
            path.join(dir, ".agents", "skills", name, "SKILL.md"),
            skill(name, `${name} skill`),
          )
        }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(2)
        expect(report.excluded.length).toBe(0)
        expect(report.conflicts.length).toBe(0)
        expect(report.missingEnv.length).toBe(0)
      },
    })
  })

  test("preserves description with colon-space pattern (no silent truncation)", async () => {
    const fullDesc = "Use the discord tool: send messages, react, and manage channels."
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "colon-desc", "SKILL.md"),
          skill("colon-desc", fullDesc),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const s = await Skill.get("colon-desc")
        expect(s).toBeDefined()
        expect(s!.description).toBe(fullDesc)
      },
    })
  })

  test("reports exclusions for missing frontmatter", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "bad", "SKILL.md"),
          "# No frontmatter at all\n\nJust content.\n",
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(0)
        expect(report.excluded.length).toBeGreaterThan(0)
      },
    })
  })

  test("reports exclusions for invalid frontmatter (missing description)", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "bad", "SKILL.md"),
          `---
name: bad-skill
---

# Bad Skill
`,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(0)
        expect(report.excluded.length).toBeGreaterThan(0)
      },
    })
  })

  test("reports name conflicts", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "dir-a", "SKILL.md"),
          skill("dupe", "first instance"),
        )
        await Bun.write(
          path.join(dir, ".claude", "skills", "dir-b", "SKILL.md"),
          skill("dupe", "second instance"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(1)
        expect(report.loaded[0].name).toBe("dupe")
        expect(report.conflicts.length).toBe(1)
        expect(report.conflicts[0].name).toBe("dupe")
        expect(report.conflicts[0].shadowed.length).toBe(1)
      },
    })
  })

  test("reports missing binary exclusions", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "needs-bin", "SKILL.md"),
          skill("needs-bin", "Requires missing binary", "requires:\n  bins:\n    - nonexistent-binary-xyz-99\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(0)
        expect(report.excluded.length).toBe(1)
        expect(report.excluded[0].reason).toContain("missing")
      },
    })
  })

  test("reports OS mismatch exclusions", async () => {
    const wrongOS = process.platform === "win32" ? "darwin" : "win32"

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "wrong-os", "SKILL.md"),
          skill("wrong-os", "Wrong OS skill", `requires:\n  os:\n    - ${wrongOS}\n`),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(0)
        expect(report.excluded.length).toBe(1)
      },
    })
  })
})

describe("Skill.all() affinity sorting", () => {
  test("sorts skills by affinity: own > shared > cross", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "@zee", "zee-skill", "SKILL.md"),
          skill("zee-skill", "Zee persona skill"),
        )
        await Bun.write(
          path.join(dir, ".agents", "skills", "@stanley", "stan-skill", "SKILL.md"),
          skill("stan-skill", "Stanley persona skill"),
        )
        await Bun.write(
          path.join(dir, ".agents", "skills", "common", "SKILL.md"),
          skill("common", "Shared skill"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const zeeSkills = await Skill.all("zee")
        expect(zeeSkills.length).toBe(3)
        expect(zeeSkills[0].name).toBe("zee-skill")
        expect(zeeSkills[0].affinity).toBe("own")
        expect(zeeSkills[1].name).toBe("common")
        expect(zeeSkills[1].affinity).toBe("shared")
        expect(zeeSkills[2].name).toBe("stan-skill")
        expect(zeeSkills[2].affinity).toBe("cross")
      },
    })
  })

  test("persona context extracted from path", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "@johny", "study", "SKILL.md"),
          skill("study", "Study skill"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        expect(skills.length).toBe(1)
        expect(skills[0].context).toBe("johny")
      },
    })
  })

  test("all skills accessible to all personas", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "@zee", "z", "SKILL.md"),
          skill("z-skill", "Zee skill"),
        )
        await Bun.write(
          path.join(dir, ".agents", "skills", "@stanley", "s", "SKILL.md"),
          skill("s-skill", "Stanley skill"),
        )
        await Bun.write(
          path.join(dir, ".agents", "skills", "@johny", "j", "SKILL.md"),
          skill("j-skill", "Johny skill"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const persona of ["zee", "stanley", "johny"]) {
          const skills = await Skill.all(persona)
          expect(skills.length).toBe(3)
          expect(skills[0].affinity).toBe("own")
          expect(skills[1].affinity).toBe("cross")
          expect(skills[2].affinity).toBe("cross")
        }
      },
    })
  })
})

describe("Skill tags and triggers", () => {
  test("tags parsed from frontmatter", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "tagged", "SKILL.md"),
          skill("tagged", "A tagged skill", "tags:\n  - finance\n  - portfolio\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const s = await Skill.get("tagged")
        expect(s).toBeDefined()
        expect(s!.tags).toEqual(["finance", "portfolio"])
      },
    })
  })

  test("triggers parsed from frontmatter", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "triggered", "SKILL.md"),
          skill("triggered", "A triggered skill", "triggers:\n  - analyze the market\n  - check stocks\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const s = await Skill.get("triggered")
        expect(s).toBeDefined()
        expect(s!.triggers).toEqual(["analyze the market", "check stocks"])
      },
    })
  })

  test("skills without tags/triggers still load", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "plain", "SKILL.md"),
          skill("plain", "No tags or triggers"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const s = await Skill.get("plain")
        expect(s).toBeDefined()
        expect(s!.tags).toBeUndefined()
        expect(s!.triggers).toBeUndefined()
      },
    })
  })
})

describe("Skill.search()", () => {
  test("matches by name substring", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "market-analysis", "SKILL.md"),
          skill("market-analysis", "Analyze markets"),
        )
        await Bun.write(
          path.join(dir, ".agents", "skills", "calendar", "SKILL.md"),
          skill("calendar", "Manage calendar"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await Skill.search("market")
        expect(results.length).toBe(1)
        expect(results[0].name).toBe("market-analysis")
      },
    })
  })

  test("matches by tag", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "portfolio", "SKILL.md"),
          skill("portfolio", "Portfolio tool", "tags:\n  - investing\n"),
        )
        await Bun.write(
          path.join(dir, ".agents", "skills", "notes", "SKILL.md"),
          skill("notes", "Take notes"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await Skill.search("investing")
        expect(results.length).toBe(1)
        expect(results[0].name).toBe("portfolio")
      },
    })
  })

  test("matches by trigger phrase", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "study", "SKILL.md"),
          skill("study", "Study tool", "triggers:\n  - help me study\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await Skill.search("study")
        expect(results.length).toBe(1)
        expect(results[0].name).toBe("study")
      },
    })
  })

  test("returns empty for non-matching query", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "alpha", "SKILL.md"),
          skill("alpha", "Alpha skill"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await Skill.search("zzzznonexistent")
        expect(results.length).toBe(0)
      },
    })
  })

  test("respects persona affinity sorting in results", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "@zee", "zee-tool", "SKILL.md"),
          skill("zee-tool", "Zee tool with keyword"),
        )
        await Bun.write(
          path.join(dir, ".agents", "skills", "@stanley", "stan-tool", "SKILL.md"),
          skill("stan-tool", "Stanley tool with keyword"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await Skill.search("keyword", "zee")
        expect(results.length).toBe(2)
        expect(results[0].name).toBe("zee-tool")
        expect(results[0].affinity).toBe("own")
        expect(results[1].name).toBe("stan-tool")
        expect(results[1].affinity).toBe("cross")
      },
    })
  })
})

describe("Skill gating", () => {
  test("loads skill when all requirements met", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "gated", "SKILL.md"),
          skill("gated", "Gated skill", `requires:\n  bins:\n    - bun\n  os:\n    - ${process.platform}\n`),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(1)
        expect(report.loaded[0].name).toBe("gated")
      },
    })
  })

  test("excludes skill when binary missing", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "missing", "SKILL.md"),
          skill("missing", "Missing binary", "requires:\n  bins:\n    - this-does-not-exist-abc\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(0)
        expect(report.excluded.length).toBe(1)
      },
    })
  })

  test("anyBins loads skill when at least one binary found", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "any-ok", "SKILL.md"),
          skill("any-ok", "Any binary skill", "requires:\n  anyBins:\n    - nonexistent-xyz\n    - bun\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(1)
        expect(report.loaded[0].name).toBe("any-ok")
      },
    })
  })

  test("anyBins excludes skill when no binary found", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "any-fail", "SKILL.md"),
          skill("any-fail", "No matching binary", "requires:\n  anyBins:\n    - nonexistent-a\n    - nonexistent-b\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(0)
        expect(report.excluded.length).toBe(1)
        expect(report.excluded[0].reason).toContain("missing any binary")
      },
    })
  })
})

describe("Skill schema warnings", () => {
  test("reports unknown frontmatter keys", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "odd", "SKILL.md"),
          skill("odd", "Has unknown keys", "customField: hello\npriority: 5\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(1)
        expect(report.schemaWarnings.length).toBe(1)
        expect(report.schemaWarnings[0].skill).toBe("odd")
        expect(report.schemaWarnings[0].unknownKeys).toContain("customField")
        expect(report.schemaWarnings[0].unknownKeys).toContain("priority")
      },
    })
  })

  test("no warnings for known keys", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "clean", "SKILL.md"),
          skill("clean", "All known keys", "version: \"1.0.0\"\nauthor: Test\ncategory: tools\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await Skill.audit()
        expect(report.loaded.length).toBe(1)
        expect(report.schemaWarnings.length).toBe(0)
      },
    })
  })
})

describe("Skill extended fields", () => {
  test("version and author parsed from frontmatter", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "versioned", "SKILL.md"),
          skill("versioned", "Has version", "version: \"2.1.0\"\nauthor: Alice\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const s = await Skill.get("versioned")
        expect(s).toBeDefined()
        expect(s!.version).toBe("2.1.0")
        expect(s!.author).toBe("Alice")
      },
    })
  })

  test("authors array normalized to author string", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, ".agents", "skills", "multi-author", "SKILL.md"),
          skill("multi-author", "Has authors array", "authors:\n  - Bob\n  - Carol\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const s = await Skill.get("multi-author")
        expect(s).toBeDefined()
        expect(s!.author).toBe("Bob")
      },
    })
  })
})
