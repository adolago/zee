import { describe, expect, test } from "bun:test"
import type { Feature } from "@/compare/types"
import { renderCompare } from "@/compare/render"

describe("compare render (json)", () => {
  test("returns a structured object", () => {
    const features: Feature[] = [
      {
        id: "x",
        category: "Positioning",
        label: "Dedicated coding agent",
        description: "A primary product surface aimed at software development workflows.",
        support: {
          zee: { level: "yes" },
          opencode: { level: "yes" },
          openclaw: { level: "partial" },
          pimono: { level: "yes" },
        },
      },
    ]

    const obj = renderCompare({
      features,
      scope: "quick",
      format: "json",
    })

    expect(typeof obj).toBe("object")
    expect((obj as any).features?.length).toBe(1)
    expect((obj as any).projects?.zee?.name).toBe("Zee")
  })
})

