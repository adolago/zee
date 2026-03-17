import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { OpenBB } from "../src/paths"

const ORIGINAL_ZEE_OPENBB_API_URL = process.env.ZEE_OPENBB_API_URL
const ORIGINAL_ZEE_OPENBB_HOME = process.env.ZEE_OPENBB_HOME

beforeEach(() => {
  delete process.env.ZEE_OPENBB_API_URL
  delete process.env.ZEE_OPENBB_HOME
})

afterEach(() => {
  if (ORIGINAL_ZEE_OPENBB_API_URL === undefined) delete process.env.ZEE_OPENBB_API_URL
  else process.env.ZEE_OPENBB_API_URL = ORIGINAL_ZEE_OPENBB_API_URL
  if (ORIGINAL_ZEE_OPENBB_HOME === undefined) delete process.env.ZEE_OPENBB_HOME
  else process.env.ZEE_OPENBB_HOME = ORIGINAL_ZEE_OPENBB_HOME
})

describe("OpenBB.preflight", () => {
  test("accepts the default local OpenBB API URL", () => {
    const err = OpenBB.preflight()
    expect(err).toBeNull()
    expect(OpenBB.apiUrl()).toBe("http://127.0.0.1:6900")
  })

  test("fails with a clear error when ZEE_OPENBB_API_URL is invalid", () => {
    process.env.ZEE_OPENBB_API_URL = "not-a-url"

    const err = OpenBB.preflight()
    expect(err).toBeDefined()
    expect(err).toContain("ZEE_OPENBB_API_URL")
    expect(err).toContain("not-a-url")
  })

  test("resolves managed runtime paths under the Zee data directory by default", () => {
    expect(OpenBB.installDir()).toContain("/zee/openbb")
    expect(OpenBB.venvDir()).toContain("/zee/openbb/.venv")
    expect(OpenBB.managedApiCommandPath()).toContain("openbb-api")
  })

  test("honors ZEE_OPENBB_HOME for managed runtime files", () => {
    process.env.ZEE_OPENBB_HOME = "/tmp/zee-openbb"

    expect(OpenBB.installDir()).toBe("/tmp/zee-openbb")
    expect(OpenBB.venvDir()).toBe("/tmp/zee-openbb/.venv")
  })
})
