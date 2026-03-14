import { describe, expect, test } from "bun:test"
import {
  CodexAuthPlugin,
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  type IdTokenClaims,
} from "../../src/plugin/codex"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

function createPluginInput() {
  return {
    client: {
      auth: {
        set: async () => true,
      },
    },
    project: {} as any,
    directory: process.cwd(),
    worktree: process.cwd(),
    serverUrl: new URL("http://localhost:3000"),
    $: Bun.$,
  } as any
}

function createProvider() {
  return {
    models: {
      "gpt-5.2": {
        cost: {
          input: 1,
          output: 1,
          cache: { read: 1, write: 1 },
        },
      },
      "gpt-5.4": {
        cost: {
          input: 1,
          output: 1,
          cache: { read: 1, write: 1 },
        },
      },
    },
  } as any
}

describe("plugin.codex", () => {
  describe("CodexAuthPlugin", () => {
    test("loader returns no options when OpenAI auth is missing", async () => {
      const hooks = await CodexAuthPlugin(createPluginInput())
      const provider = createProvider()

      const result = await hooks.auth!.loader!(async () => undefined, provider)

      expect(result).toEqual({})
      expect(Object.keys(provider.models)).toEqual(["gpt-5.2", "gpt-5.4"])
      expect(provider.models["gpt-5.4"].cost.input).toBe(1)
    })

    test("wrapped fetch throws a readable error when OpenAI oauth disappears", async () => {
      let authCalls = 0
      const getAuth = async () => {
        authCalls += 1
        if (authCalls === 1) {
          return {
            type: "oauth" as const,
            access: "access-token",
            refresh: "refresh-token",
            expires: Date.now() + 60_000,
          }
        }
        return undefined
      }

      const hooks = await CodexAuthPlugin(createPluginInput())
      const provider = createProvider()
      const options = await hooks.auth!.loader!(getAuth, provider)

      await expect(
        options.fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            authorization: "Bearer dummy",
          },
          body: JSON.stringify({ input: [] }),
        }),
      ).rejects.toThrow("OpenAI OAuth session is no longer available")
    })
  })

  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })
})
