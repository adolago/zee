import { describe, expect, test } from "bun:test"
import { extractAuthFromFrontmatter } from "../../src/cli/cmd/auth"

describe("extractAuthFromFrontmatter", () => {
  test("merges requires.env with metadata hints and dedupes", () => {
    const result = extractAuthFromFrontmatter({
      requires: { env: ["TOP_ENV", "", 123, "TOP_ENV"] },
      metadata: {
        primaryEnv: "META_PRIMARY",
        requires: { env: ["META_ENV", "TOP_ENV"] },
        zee: { primaryEnv: "ZEE_PRIMARY", requires: { env: ["ZEE_ENV"] } },
      },
    })

    expect(result.primaryEnv).toBe("META_PRIMARY")
    expect(result.envVars).toEqual(["TOP_ENV", "META_ENV", "ZEE_ENV"])
  })

  test("parses metadata when provided as JSON string", () => {
    const result = extractAuthFromFrontmatter({
      requires: { env: ["TOP_ENV"] },
      metadata: JSON.stringify({ primaryEnv: "META_PRIMARY", requires: { env: ["META_ENV"] } }),
    })

    expect(result.primaryEnv).toBe("META_PRIMARY")
    expect(result.envVars).toEqual(["TOP_ENV", "META_ENV"])
  })

  test("ignores invalid metadata strings", () => {
    const result = extractAuthFromFrontmatter({
      requires: { env: ["TOP_ENV"] },
      metadata: "{invalid json",
    })

    expect(result.primaryEnv).toBeUndefined()
    expect(result.envVars).toEqual(["TOP_ENV"])
  })
})
