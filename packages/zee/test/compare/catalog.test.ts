import { describe, expect, test } from "bun:test"
import { FEATURE_CATALOG } from "@/compare/catalog"
import type { ProjectId } from "@/compare/types"

const PROJECTS: ProjectId[] = ["zee", "opencode", "openclaw", "pimono"]

describe("compare catalog", () => {
  test("feature ids are unique and support matrix is complete", () => {
    const ids = new Set<string>()

    for (const f of FEATURE_CATALOG) {
      expect(f.id).toBeTruthy()
      expect(ids.has(f.id)).toBe(false)
      ids.add(f.id)

      expect(f.category).toBeTruthy()
      expect(f.label).toBeTruthy()
      expect(f.description).toBeTruthy()

      for (const p of PROJECTS) {
        expect(f.support[p]).toBeTruthy()
        expect(f.support[p].level).toBeTruthy()
      }
    }
  })
})

