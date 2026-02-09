import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Auth } from "../../src/auth"
import { Global } from "../../src/global"

// Helper to create test auth file
async function writeAuthFile(data: Record<string, unknown>) {
  const filepath = path.join(Global.Path.data, "auth.json")
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  await Bun.write(filepath, JSON.stringify(data, null, 2))
  await fs.chmod(filepath, 0o600)
}

// Helper to read auth file directly
async function readAuthFile(): Promise<Record<string, unknown>> {
  const filepath = path.join(Global.Path.data, "auth.json")
  const file = Bun.file(filepath)
  return file.json().catch(() => ({}))
}

// Helper to clean up auth file
async function cleanupAuthFile() {
  const filepath = path.join(Global.Path.data, "auth.json")
  await fs.rm(filepath, { force: true })
}

describe("Auth.isExpiringSoon", () => {
  test("returns false for non-oauth auth", () => {
    const apiAuth: Auth.Info = { type: "api", key: "test-key" }
    expect(Auth.isExpiringSoon(apiAuth)).toBe(false)
  })

  test("returns false for oauth token not expiring soon", () => {
    const oauthAuth: Auth.Info = {
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60 * 60 * 1000, // 1 hour from now
    }
    expect(Auth.isExpiringSoon(oauthAuth)).toBe(false)
  })

  test("returns true for oauth token expiring within buffer (10 min)", () => {
    const oauthAuth: Auth.Info = {
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes from now
    }
    expect(Auth.isExpiringSoon(oauthAuth)).toBe(true)
  })

  test("returns true for already expired token", () => {
    const oauthAuth: Auth.Info = {
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() - 1000, // 1 second ago
    }
    expect(Auth.isExpiringSoon(oauthAuth)).toBe(true)
  })
})

describe("Auth.isExpired", () => {
  test("returns false for non-oauth auth", () => {
    const apiAuth: Auth.Info = { type: "api", key: "test-key" }
    expect(Auth.isExpired(apiAuth)).toBe(false)
  })

  test("returns false for valid oauth token", () => {
    const oauthAuth: Auth.Info = {
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60 * 60 * 1000, // 1 hour from now
    }
    expect(Auth.isExpired(oauthAuth)).toBe(false)
  })

  test("returns true for expired oauth token", () => {
    const oauthAuth: Auth.Info = {
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() - 1000, // 1 second ago
    }
    expect(Auth.isExpired(oauthAuth)).toBe(true)
  })

  test("returns false for token expiring soon but not yet expired", () => {
    const oauthAuth: Auth.Info = {
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes from now
    }
    expect(Auth.isExpired(oauthAuth)).toBe(false)
  })
})

describe("Auth file operations", () => {
  beforeEach(async () => {
    await cleanupAuthFile()
  })

  afterEach(async () => {
    await cleanupAuthFile()
  })

  describe("Auth.all", () => {
    test("returns empty object when auth file does not exist", async () => {
      const result = await Auth.all()
      expect(result).toEqual({})
    })

    test("returns empty object when auth file is invalid JSON", async () => {
      const filepath = path.join(Global.Path.data, "auth.json")
      await fs.mkdir(path.dirname(filepath), { recursive: true })
      await Bun.write(filepath, "not valid json")

      const result = await Auth.all()
      expect(result).toEqual({})
    })

    test("parses valid oauth entries", async () => {
      await writeAuthFile({
        anthropic: {
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: 1234567890000,
        },
      })

      const result = await Auth.all()
      expect(result.anthropic).toBeDefined()
      expect(result.anthropic.type).toBe("oauth")
      expect((result.anthropic as any).access).toBe("access-token")
    })

    test("parses valid api entries", async () => {
      await writeAuthFile({
        openrouter: {
          type: "api",
          key: "sk-or-v1-test",
        },
      })

      const result = await Auth.all()
      expect(result.openrouter).toBeDefined()
      expect(result.openrouter.type).toBe("api")
      expect((result.openrouter as any).key).toBe("sk-or-v1-test")
    })

    test("parses valid wellknown entries", async () => {
      await writeAuthFile({
        custom: {
          type: "wellknown",
          key: "well-known-key",
          token: "well-known-token",
        },
      })

      const result = await Auth.all()
      expect(result.custom).toBeDefined()
      expect(result.custom.type).toBe("wellknown")
    })

    test("skips invalid entries", async () => {
      await writeAuthFile({
        valid: {
          type: "api",
          key: "valid-key",
        },
        invalid: {
          type: "unknown",
          foo: "bar",
        },
        alsoInvalid: "not an object",
      })

      const result = await Auth.all()
      expect(result.valid).toBeDefined()
      expect(result.invalid).toBeUndefined()
      expect(result.alsoInvalid).toBeUndefined()
    })

    test("preserves extra fields on oauth (passthrough)", async () => {
      await writeAuthFile({
        google: {
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: 1234567890000,
          email: "user@example.com",
          projectId: "project-123",
        },
      })

      const result = await Auth.all()
      expect(result.google).toBeDefined()
      expect((result.google as any).email).toBe("user@example.com")
      expect((result.google as any).projectId).toBe("project-123")
    })
  })

  describe("Auth.get", () => {
    test("returns undefined for non-existent provider", async () => {
      const result = await Auth.get("nonexistent")
      expect(result).toBeUndefined()
    })

    test("returns auth info for existing provider", async () => {
      await writeAuthFile({
        anthropic: {
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: 1234567890000,
        },
      })

      const result = await Auth.get("anthropic")
      expect(result).toBeDefined()
      expect(result?.type).toBe("oauth")
    })
  })

  describe("Auth.set", () => {
    test("creates auth file if it does not exist", async () => {
      await Auth.set("newprovider", {
        type: "api",
        key: "new-key",
      })

      const data = await readAuthFile()
      expect(data.newprovider).toBeDefined()
      expect((data.newprovider as any).key).toBe("new-key")
    })

    test("adds entry to existing auth file", async () => {
      await writeAuthFile({
        existing: {
          type: "api",
          key: "existing-key",
        },
      })

      await Auth.set("newprovider", {
        type: "api",
        key: "new-key",
      })

      const data = await readAuthFile()
      expect(data.existing).toBeDefined()
      expect(data.newprovider).toBeDefined()
    })

    test("overwrites existing entry", async () => {
      await writeAuthFile({
        provider: {
          type: "api",
          key: "old-key",
        },
      })

      await Auth.set("provider", {
        type: "api",
        key: "new-key",
      })

      const data = await readAuthFile()
      expect((data.provider as any).key).toBe("new-key")
    })

    test("sets correct file permissions (0o600)", async () => {
      await Auth.set("provider", {
        type: "api",
        key: "secret-key",
      })

      const filepath = path.join(Global.Path.data, "auth.json")
      const stats = await fs.stat(filepath)
      // Check that only owner has read/write permissions
      expect(stats.mode & 0o777).toBe(0o600)
    })
  })

  describe("Auth.remove", () => {
    test("removes existing entry", async () => {
      await writeAuthFile({
        toRemove: {
          type: "api",
          key: "key",
        },
        toKeep: {
          type: "api",
          key: "other-key",
        },
      })

      await Auth.remove("toRemove")

      const data = await readAuthFile()
      expect(data.toRemove).toBeUndefined()
      expect(data.toKeep).toBeDefined()
    })

    test("does nothing for non-existent entry", async () => {
      await writeAuthFile({
        existing: {
          type: "api",
          key: "key",
        },
      })

      await Auth.remove("nonexistent")

      const data = await readAuthFile()
      expect(data.existing).toBeDefined()
    })
  })
})

describe("Auth.status", () => {
  beforeEach(async () => {
    await cleanupAuthFile()
  })

  afterEach(async () => {
    await cleanupAuthFile()
  })

  test("returns empty object when no auth entries", async () => {
    const result = await Auth.status()
    expect(result).toEqual({})
  })

  test("returns valid=true for non-expired oauth token", async () => {
    await writeAuthFile({
      anthropic: {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      },
    })

    const result = await Auth.status()
    expect(result.anthropic.valid).toBe(true)
    expect(result.anthropic.expiringSoon).toBe(false)
    expect(result.anthropic.expiresIn).toBeGreaterThan(0)
  })

  test("returns valid=false for expired oauth token", async () => {
    await writeAuthFile({
      anthropic: {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() - 1000, // 1 second ago
      },
    })

    const result = await Auth.status()
    expect(result.anthropic.valid).toBe(false)
    expect(result.anthropic.expiresIn).toBeLessThan(0)
  })

  test("returns expiringSoon=true for token expiring within 10 min", async () => {
    await writeAuthFile({
      anthropic: {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 5 * 60 * 1000, // 5 minutes
      },
    })

    const result = await Auth.status()
    expect(result.anthropic.valid).toBe(true)
    expect(result.anthropic.expiringSoon).toBe(true)
  })

  test("returns valid=true with null expiresIn for api auth", async () => {
    await writeAuthFile({
      openrouter: {
        type: "api",
        key: "sk-or-key",
      },
    })

    const result = await Auth.status()
    expect(result.openrouter.valid).toBe(true)
    expect(result.openrouter.expiringSoon).toBe(false)
    expect(result.openrouter.expiresIn).toBeNull()
  })

  test("handles multiple providers", async () => {
    await writeAuthFile({
      anthropic: {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 60 * 60 * 1000,
      },
      openrouter: {
        type: "api",
        key: "key",
      },
      expired: {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() - 1000,
      },
    })

    const result = await Auth.status()
    expect(Object.keys(result)).toHaveLength(3)
    expect(result.anthropic.valid).toBe(true)
    expect(result.openrouter.valid).toBe(true)
    expect(result.expired.valid).toBe(false)
  })
})

describe("Auth.refreshToken", () => {
  beforeEach(async () => {
    await cleanupAuthFile()
  })

  afterEach(async () => {
    await cleanupAuthFile()
  })

  test("returns false for non-existent provider", async () => {
    const result = await Auth.refreshToken("nonexistent")
    expect(result).toBe(false)
  })

  test("returns false for api auth (non-oauth)", async () => {
    await writeAuthFile({
      openrouter: {
        type: "api",
        key: "key",
      },
    })

    const result = await Auth.refreshToken("openrouter")
    expect(result).toBe(false)
  })

  test("returns false for provider without refresh config", async () => {
    await writeAuthFile({
      google: {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 1000,
      },
    })

    // google uses a custom flow, not standard OAuth refresh
    const result = await Auth.refreshToken("google")
    expect(result).toBe(false)
  })

  // Network tests would require mocking fetch
  // Skipping actual refresh tests as they require network access
})

describe("Auth.refreshAllExpiring", () => {
  beforeEach(async () => {
    await cleanupAuthFile()
  })

  afterEach(async () => {
    await cleanupAuthFile()
  })

  test("returns empty arrays when no tokens are expiring", async () => {
    await writeAuthFile({
      anthropic: {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 60 * 60 * 1000, // 1 hour (not expiring soon)
      },
    })

    const result = await Auth.refreshAllExpiring()
    expect(result.refreshed).toEqual([])
    expect(result.failed).toEqual([])
  })

  test("returns empty arrays when no auth entries", async () => {
    const result = await Auth.refreshAllExpiring()
    expect(result.refreshed).toEqual([])
    expect(result.failed).toEqual([])
  })

  test("skips api auth entries", async () => {
    await writeAuthFile({
      openrouter: {
        type: "api",
        key: "key",
      },
    })

    const result = await Auth.refreshAllExpiring()
    expect(result.refreshed).toEqual([])
    expect(result.failed).toEqual([])
  })

  test("skips providers without refresh config", async () => {
    await writeAuthFile({
      google: {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 1000, // Expiring soon but no refresh config
      },
    })

    const result = await Auth.refreshAllExpiring()
    expect(result.refreshed).toEqual([])
    expect(result.failed).toEqual([])
  })
})

describe("Auth schema validation", () => {
  test("Oauth schema validates correctly", () => {
    const valid = Auth.Oauth.safeParse({
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: 1234567890000,
    })
    expect(valid.success).toBe(true)
  })

  test("Oauth schema allows extra fields", () => {
    const valid = Auth.Oauth.safeParse({
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: 1234567890000,
      email: "user@example.com",
      customField: "custom-value",
    })
    expect(valid.success).toBe(true)
    if (valid.success) {
      expect((valid.data as any).email).toBe("user@example.com")
    }
  })

  test("Oauth schema rejects missing required fields", () => {
    const invalid = Auth.Oauth.safeParse({
      type: "oauth",
      refresh: "refresh-token",
      // missing access and expires
    })
    expect(invalid.success).toBe(false)
  })

  test("Api schema validates correctly", () => {
    const valid = Auth.Api.safeParse({
      type: "api",
      key: "sk-api-key",
    })
    expect(valid.success).toBe(true)
  })

  test("Api schema rejects missing key", () => {
    const invalid = Auth.Api.safeParse({
      type: "api",
    })
    expect(invalid.success).toBe(false)
  })

  test("WellKnown schema validates correctly", () => {
    const valid = Auth.WellKnown.safeParse({
      type: "wellknown",
      key: "well-known-key",
      token: "well-known-token",
    })
    expect(valid.success).toBe(true)
  })

  test("Info union discriminates correctly", () => {
    const oauth = Auth.Info.safeParse({
      type: "oauth",
      refresh: "r",
      access: "a",
      expires: 123,
    })
    const api = Auth.Info.safeParse({
      type: "api",
      key: "k",
    })
    const wellknown = Auth.Info.safeParse({
      type: "wellknown",
      key: "k",
      token: "t",
    })

    expect(oauth.success).toBe(true)
    expect(api.success).toBe(true)
    expect(wellknown.success).toBe(true)

    if (oauth.success) expect(oauth.data.type).toBe("oauth")
    if (api.success) expect(api.data.type).toBe("api")
    if (wellknown.success) expect(wellknown.data.type).toBe("wellknown")
  })

  test("Info union rejects unknown type", () => {
    const invalid = Auth.Info.safeParse({
      type: "unknown",
      data: "whatever",
    })
    expect(invalid.success).toBe(false)
  })
})
