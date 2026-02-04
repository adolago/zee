import { test, expect, describe } from "bun:test"
import { Config } from "../../src/config/config"

describe("Config Redaction", () => {
  const sensitiveConfig = {
    provider: {
      openai: {
        options: {
          apiKey: "sk-secret-key",
        },
      },
    },
    zee: {
      splitwise: {
        token: "secret-token",
      },
    },
    mcp: {
      github: {
        type: "remote",
        url: "https://example.com",
        oauth: {
          clientId: "id",
          clientSecret: "secret-client-secret",
        },
      },
    },
    grammar: {
      provider: "languagetool",
      apiKey: "grammar-key",
    },
    experimental: {
      surfaces: {
        telegram: {
          botToken: "telegram-token",
        },
      },
    },
  } as Config.Info

  test("redact masks sensitive fields", () => {
    // @ts-ignore
    const redacted = Config.redact(sensitiveConfig)

    // @ts-ignore
    expect(redacted.provider.openai.options.apiKey).toBe("***")
    // @ts-ignore
    expect(redacted.zee.splitwise.token).toBe("***")
    // @ts-ignore
    expect(redacted.mcp.github.oauth.clientSecret).toBe("***")
    // @ts-ignore
    expect(redacted.grammar.apiKey).toBe("***")
    // @ts-ignore
    expect(redacted.experimental.surfaces.telegram.botToken).toBe("***")

    // Should preserve other fields
    // @ts-ignore
    expect(redacted.mcp.github.url).toBe("https://example.com")
  })

  test("clean removes redacted fields", () => {
    const redactedConfig = {
      provider: {
        openai: {
          options: {
            apiKey: "***",
            baseURL: "https://api.openai.com",
          },
        },
      },
    } as Config.Info

    // @ts-ignore
    const cleaned = Config.clean(redactedConfig)

    // @ts-ignore
    expect(cleaned.provider.openai.options.apiKey).toBeUndefined()
    // @ts-ignore
    expect(cleaned.provider.openai.options.baseURL).toBe("https://api.openai.com")
  })
})
