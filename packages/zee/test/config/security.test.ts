import { test, expect, describe } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import { ConfigRoute } from "../../src/server/route/config"

describe("Config security", () => {
  test("redact hides sensitive fields", () => {
    const config: Config.Info = {
      provider: {
        openai: {
          options: {
            apiKey: "secret_api_key",
          },
        },
      },
      memory: {
        redisUrl: "redis://:password@localhost:6379",
        qdrant: {},
        embedding: {
          provider: "google",
        },
      },
      zee: {
        splitwise: {
          token: "secret_splitwise_token",
        },
      },
      grammar: {
        provider: "languagetool",
        apiKey: "secret_grammar_key",
      },
      mcp: {
        remote: {
          type: "remote",
          url: "http://example.com",
          oauth: {
            clientSecret: "secret_oauth_client_secret",
          },
        },
      },
    }

    const redacted = Config.redact(config)

    expect(redacted.provider?.openai?.options?.apiKey).toBe("********")
    expect(redacted.memory?.redisUrl).toBe("********")
    expect(redacted.memory?.embedding?.provider).toBe("google")
    expect(redacted.zee?.splitwise?.token).toBe("********")
    expect(redacted.grammar?.apiKey).toBe("********")
    // Check MCP redaction
    const mcpRemote = redacted.mcp?.remote as any
    expect(mcpRemote?.oauth?.clientSecret).toBe("********")
  })

  test("clean removes redacted fields", () => {
    const config: Config.Info = {
      provider: {
        openai: {
          options: {
            apiKey: "********",
            baseURL: "https://api.openai.com",
          },
        },
      },
      memory: {
        redisUrl: "********",
      },
    }

    const cleaned = Config.clean(config)

    expect(cleaned.provider?.openai?.options?.apiKey).toBeUndefined()
    expect(cleaned.provider?.openai?.options?.baseURL).toBe("https://api.openai.com")
    expect(cleaned.memory?.redisUrl).toBeUndefined()
  })

  test("clean preserves non-redacted fields", () => {
    const config: Config.Info = {
      theme: "dark",
      provider: {
        openai: {
          options: {
            apiKey: "new_secret_key",
          },
        },
      },
    }

    const cleaned = Config.clean(config)

    expect(cleaned.theme).toBe("dark")
    expect(cleaned.provider?.openai?.options?.apiKey).toBe("new_secret_key")
  })

  test("GET /config returns redacted secrets", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Use zee.json because Config.get() reads it
        await Bun.write(
          path.join(dir, "zee.json"),
          JSON.stringify({
            $schema: "zee",
            provider: {
              openai: {
                options: {
                  apiKey: "secret_api_key",
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = ConfigRoute
        const res = await app.request("/config")
        const body = (await res.json()) as Config.Info

        expect(res.status).toBe(200)
        expect(body.provider?.openai?.options?.apiKey).toBe("********")
      },
    })
  })

  test("PATCH /config prevents overwriting secrets with redaction placeholder", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Use config.json because Config.update() writes to it
        await Bun.write(
          path.join(dir, "config.json"),
          JSON.stringify({
            $schema: "zee",
            provider: {
              openai: {
                options: {
                  apiKey: "secret_api_key",
                  baseURL: "old_url",
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = ConfigRoute

        // We manually construct payload because Config.get() might not read config.json in test env
        const patchPayload: Config.Info = {
          provider: {
            openai: {
              options: {
                apiKey: "********", // Redacted value sent back
                baseURL: "new_url",
              },
            },
          },
        }

        const patchRes = await app.request("/config", {
          method: "PATCH",
          body: JSON.stringify(patchPayload),
          headers: { "Content-Type": "application/json" },
        })

        expect(patchRes.status).toBe(200)
        // We don't check body content for baseURL because Config.get() might return old config

        // Verify file on disk still has the original secret
        const fileContent = await Bun.file(path.join(tmp.path, "config.json")).text()
        const fileJson = JSON.parse(fileContent)

        // Secret should be preserved (not overwritten by ******** or undefined)
        expect(fileJson.provider.openai.options.apiKey).toBe("secret_api_key")
        // Update should be applied
        expect(fileJson.provider.openai.options.baseURL).toBe("new_url")
      },
    })
  })
})
