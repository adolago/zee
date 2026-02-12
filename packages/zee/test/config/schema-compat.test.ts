import { test, expect, describe } from "bun:test"
import { Config } from "../../src/config/config"
import { ZeeSchema } from "../../Swabble/src/config/zod-schema"
import type { z } from "zod"

/**
 * Cross-schema compatibility tests.
 *
 * ~/.zee/zee.json is read by two independent strict schemas:
 *   1. Config.Info   (engine / TUI)
 *   2. ZeeSchema     (gateway / daemon)
 *
 * Both use .strict(), so any key one writes that the other doesn't
 * know about causes a hard runtime failure. These tests ensure
 * auto-written keys are accepted by both schemas.
 *
 * The engine auto-injects "$schema" into config files that lack it
 * (see config.ts load()). If the gateway schema doesn't recognize
 * "$schema", the daemon crashes on the next restart. This is the
 * exact bug this test prevents.
 */

function topLevelKeys(schema: z.ZodObject<any>): Set<string> {
  return new Set(Object.keys(schema.shape))
}

/** Keys that either schema auto-writes to config files on disk. */
const AUTO_WRITTEN_KEYS = ["$schema"]

describe("engine (Config.Info) and gateway (ZeeSchema) schema compatibility", () => {
  const engineKeys = topLevelKeys(Config.Info as unknown as z.ZodObject<any>)
  const gatewayKeys = topLevelKeys(ZeeSchema as unknown as z.ZodObject<any>)

  for (const key of AUTO_WRITTEN_KEYS) {
    test(`both schemas accept auto-written key "${key}"`, () => {
      expect(engineKeys.has(key)).toBe(true)
      expect(gatewayKeys.has(key)).toBe(true)
    })
  }

  test("gateway schema accepts a config with only auto-written keys", () => {
    const config = Object.fromEntries(AUTO_WRITTEN_KEYS.map((k) => [k, "zee"]))
    const result = ZeeSchema.safeParse(config)
    const unrecognized = result.error?.issues?.filter((i) => i.code === "unrecognized_keys") ?? []
    expect(unrecognized).toEqual([])
  })

  test("engine schema accepts a config with only auto-written keys", () => {
    const config = Object.fromEntries(AUTO_WRITTEN_KEYS.map((k) => [k, "zee"]))
    const result = Config.Info.safeParse(config)
    const unrecognized = result.error?.issues?.filter((i) => i.code === "unrecognized_keys") ?? []
    expect(unrecognized).toEqual([])
  })

  test("schemas share expected overlap for keys present in both", () => {
    // Keys that happen to exist in both schemas today. If a key is
    // removed from one schema, this test will flag it so the removal
    // is intentional rather than accidental drift.
    const expectedShared = ["$schema", "cron", "messages", "skills", "tools"]
    const actualShared = [...engineKeys].filter((k) => gatewayKeys.has(k))
    for (const key of expectedShared) {
      expect(actualShared).toContain(key)
    }
  })
})
