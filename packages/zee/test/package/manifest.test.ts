import { describe, expect, test } from "bun:test"
import path from "node:path"
import fs from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import { loadPackageMetadata, validateManifestPaths } from "../../src/package/manifest"

describe("package manifest", () => {
  test("loads manifest from package.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "package.json"),
          JSON.stringify({ name: "@acme/pkg", zee: { skills: ["skills"] } }),
        )
        await fs.mkdir(path.join(dir, "skills"), { recursive: true })
        await Bun.write(path.join(dir, "skills", "SKILL.md"), "# test")
      },
    })

    const meta = await loadPackageMetadata(tmp.path)
    expect(meta.name).toBe("@acme/pkg")
    expect(meta.manifest.skills).toEqual(["skills"])
    expect(meta.manifest.plugins).toEqual([])
  })

  test("rejects resource paths escaping package root", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "package.json"),
          JSON.stringify({ name: "@acme/pkg", zee: { skills: ["../oops"] } }),
        )
      },
    })

    const meta = await loadPackageMetadata(tmp.path)
    const errors = validateManifestPaths(meta)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain("escapes package root")
  })
})
