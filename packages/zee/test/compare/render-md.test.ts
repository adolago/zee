import { describe, expect, test } from "bun:test"
import type { CompareSnapshot } from "@/compare/snapshot"
import type { Feature } from "@/compare/types"
import { renderCompare } from "@/compare/render"

describe("compare render (md)", () => {
  test("renders a stable markdown header and table", () => {
    const features: Feature[] = [
      {
        id: "a",
        category: "Surfaces",
        label: "CLI",
        description: "Command-line interface.",
        support: {
          zee: { level: "yes" },
          opencode: { level: "yes" },
          openclaw: { level: "yes" },
          pimono: { level: "yes" },
        },
      },
      {
        id: "b",
        category: "Memory",
        label: "Semantic memory",
        description: "Long-term semantic recall.",
        support: {
          zee: { level: "yes" },
          opencode: { level: "no" },
          openclaw: { level: "partial", notes: "Different storage model." },
          pimono: { level: "unknown" },
        },
      },
    ]

    const snapshot: CompareSnapshot = {
      generatedAt: "2026-02-12T00:00:00.000Z",
      sourceRoot: "/tmp/zee",
      zee: { version: "0.0.0", channel: "local", runtimeMode: "source", gitSha: "deadbeef" },
      upstream: {},
      pimono: {},
      warnings: [],
    }

    const out = String(
      renderCompare({
        features,
        snapshot,
        scope: "full",
        format: "md",
      }),
    )

    expect(out).toContain("# Feature Comparison")
    expect(out).toContain("## Feature Matrix")
    expect(out).toContain("| Feature | Description | Zee | OpenCode | OpenClaw | Pi-mono |")
    expect(out).toContain("Semantic memory")
    expect(out).toContain("## Notes (Full)")
  })
})
