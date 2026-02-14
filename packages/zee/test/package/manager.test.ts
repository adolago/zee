import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { formatManifestKinds, inspectPackageConfig, listInstalled } from "../../src/package/manager"

describe("package manager", () => {
  test("formatManifestKinds only includes non-empty resources", () => {
    const summary = formatManifestKinds({
      plugins: [],
      skills: ["skills"],
      prompts: [],
      themes: ["themes/a", "themes/b"],
      extensions: [],
    })
    expect(summary).toEqual({
      skills: 1,
      themes: 2,
    })
  })

  test("inspectPackageConfig returns empty installs initially", async () => {
    await using tmp = await tmpdir()
    const prev = process.env.ZEE_TEST_HOME
    process.env.ZEE_TEST_HOME = tmp.path
    try {
      const cfg = await inspectPackageConfig({ scope: "global" })
      const installs = await listInstalled({ scope: "global" })
      expect(cfg.scope).toBe("global")
      expect(Array.isArray(cfg.installs)).toBe(true)
      expect(installs).toEqual([])
    } finally {
      process.env.ZEE_TEST_HOME = prev
    }
  })
})

