import { describe, test, expect } from "bun:test"
import {
  containsShellMetacharacters,
  sanitizeEnvValue,
  isValidPathValue,
  createSafeEnv,
  auditEnv,
} from "../../src/security/env-sanitize.js"

describe("containsShellMetacharacters", () => {
  test("detects command substitution", () => {
    expect(containsShellMetacharacters("$(touch /tmp/pwned)")).toBe(true)
    expect(containsShellMetacharacters("`id`")).toBe(true)
  })

  test("detects shell operators", () => {
    expect(containsShellMetacharacters("foo; rm -rf /")).toBe(true)
    expect(containsShellMetacharacters("foo && malicious")).toBe(true)
    expect(containsShellMetacharacters("foo | cat /etc/passwd")).toBe(true)
  })

  test("allows safe values", () => {
    expect(containsShellMetacharacters("/usr/local/bin:/usr/bin:/bin")).toBe(false)
    expect(containsShellMetacharacters("C:\\Program Files\\Node")).toBe(false)
    expect(containsShellMetacharacters("simple-value-123")).toBe(false)
  })
})

describe("sanitizeEnvValue", () => {
  test("removes shell metacharacters", () => {
    // $ and () are removed
    expect(sanitizeEnvValue("$(whoami)")).toBe("whoami")
    expect(sanitizeEnvValue("foo;bar")).toBe("foobar")
    expect(sanitizeEnvValue("safe-value")).toBe("safe-value")
    // Backticks are removed
    expect(sanitizeEnvValue("`id`")).toBe("id")
  })
})

describe("isValidPathValue", () => {
  test("accepts valid Unix paths", () => {
    expect(isValidPathValue("/usr/local/bin:/usr/bin:/bin")).toBe(true)
    expect(isValidPathValue("/home/user/.local/bin")).toBe(true)
  })

  test("accepts valid Windows paths", () => {
    expect(isValidPathValue("C:\\Windows\\System32;C:\\Windows")).toBe(true)
    expect(isValidPathValue("C:\\Program Files\\Node")).toBe(true)
  })

  test("rejects command injection", () => {
    expect(isValidPathValue("$(touch /tmp/pwned)")).toBe(false)
    expect(isValidPathValue("/bin:`id`")).toBe(false)
  })
})

describe("createSafeEnv", () => {
  test("passes through safe environment", () => {
    const env = { PATH: "/usr/bin:/bin", HOME: "/home/user" }
    const safe = createSafeEnv(env)
    expect(safe.PATH).toBe("/usr/bin:/bin")
    expect(safe.HOME).toBe("/home/user")
  })

  test("sanitizes dangerous PATH", () => {
    const env = { PATH: "$(touch /tmp/pwned):/usr/bin" }
    const safe = createSafeEnv(env)
    // Should use default safe PATH instead
    expect(safe.PATH).not.toContain("$(")
  })

  test("prepends paths via internal variable", () => {
    const env = { PATH: "/usr/bin" }
    const safe = createSafeEnv(env, { prependPaths: ["/custom/bin"] })
    expect(safe.PATH).toContain("/custom/bin")
    expect(safe.AGENT_CORE_PREPEND_PATH).toBe("/custom/bin")
  })

  test("respects blocklist", () => {
    const env = { PATH: "/usr/bin", SECRET_KEY: "sensitive" }
    const safe = createSafeEnv(env, { blocklist: ["SECRET_KEY"] })
    expect(safe.PATH).toBe("/usr/bin")
    expect(safe.SECRET_KEY).toBeUndefined()
  })

  test("respects allowlist", () => {
    const env = { CUSTOM_VAR: "$(this would normally be suspicious)" }
    const safe = createSafeEnv(env, { allowlist: ["CUSTOM_VAR"] })
    expect(safe.CUSTOM_VAR).toBe("$(this would normally be suspicious)")
  })
})

describe("auditEnv", () => {
  test("returns empty for safe env", () => {
    const warnings = auditEnv({ PATH: "/usr/bin", HOME: "/home/user" })
    expect(warnings).toHaveLength(0)
  })

  test("warns about command substitution", () => {
    const warnings = auditEnv({ PATH: "$(id)" })
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.includes("command substitution"))).toBe(true)
  })

  test("warns about shell metacharacters", () => {
    const warnings = auditEnv({ FOO: "bar;baz" })
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.includes("metacharacters"))).toBe(true)
  })
})
