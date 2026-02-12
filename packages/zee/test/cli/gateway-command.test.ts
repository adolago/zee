import { describe, expect, test } from "bun:test"
import { resolveGatewayWsUrl } from "../../src/cli/cmd/gateway/util"

describe("zee gateway", () => {
  test("uses ZEE_GATEWAY_URL override when set", () => {
    const url = resolveGatewayWsUrl({
      ZEE_GATEWAY_URL: "ws://example.invalid:18789",
    } as unknown as NodeJS.ProcessEnv)
    expect(url).toBe("ws://example.invalid:18789")
  })
})

