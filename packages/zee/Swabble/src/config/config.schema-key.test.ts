import { describe, expect, it } from "vitest"
import { ZeeSchema } from "./zod-schema.js"

describe("config $schema key", () => {
  it("accepts config with $schema string", () => {
    const result = ZeeSchema.safeParse({
      $schema: "https://schemas.zee.local/config.schema.json",
    })
    expect(result.success).toBe(true)
  })

  it("accepts config without $schema", () => {
    const result = ZeeSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("rejects non-string $schema", () => {
    const result = ZeeSchema.safeParse({
      $schema: 123,
    })
    expect(result.success).toBe(false)
  })
})
