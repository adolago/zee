import { describe, expect, test } from "bun:test"
import {
  extractBasicCredentials,
  extractBearerToken,
  extractGatewayRouteSecret,
  isMatchingSecret,
} from "../../src/security/http-auth.js"

describe("extractBearerToken", () => {
  test("extracts token from bearer header", () => {
    expect(extractBearerToken("Bearer secret-token")).toBe("secret-token")
    expect(extractBearerToken("bearer    token-2  ")).toBe("token-2")
  })

  test("returns undefined for non-bearer values", () => {
    expect(extractBearerToken(undefined)).toBeUndefined()
    expect(extractBearerToken(null)).toBeUndefined()
    expect(extractBearerToken("Basic abc123")).toBeUndefined()
  })
})

describe("extractBasicCredentials", () => {
  test("parses username/password from basic header", () => {
    const encoded = Buffer.from("zee:test-password", "utf-8").toString("base64")
    expect(extractBasicCredentials(`Basic ${encoded}`)).toEqual({
      username: "zee",
      password: "test-password",
    })
  })

  test("supports password containing colons", () => {
    const encoded = Buffer.from("zee:part:two", "utf-8").toString("base64")
    expect(extractBasicCredentials(`Basic ${encoded}`)).toEqual({
      username: "zee",
      password: "part:two",
    })
  })

  test("returns undefined for malformed basic auth", () => {
    expect(extractBasicCredentials(undefined)).toBeUndefined()
    expect(extractBasicCredentials("Bearer token")).toBeUndefined()
    expect(extractBasicCredentials("Basic !!!not-base64!!!")).toBeUndefined()
    const noSeparator = Buffer.from("justusername", "utf-8").toString("base64")
    expect(extractBasicCredentials(`Basic ${noSeparator}`)).toBeUndefined()
  })
})

describe("extractGatewayRouteSecret", () => {
  test("prefers x-zee-gateway-token over bearer auth header", () => {
    const headers = new Headers({
      "x-zee-gateway-token": "direct-secret",
      Authorization: "Bearer bearer-secret",
    })
    expect(extractGatewayRouteSecret(headers)).toBe("direct-secret")
  })

  test("falls back to bearer auth header", () => {
    const headers = new Headers({
      Authorization: "Bearer bearer-secret",
    })
    expect(extractGatewayRouteSecret(headers)).toBe("bearer-secret")
  })

  test("returns undefined with no supported headers", () => {
    expect(extractGatewayRouteSecret(new Headers())).toBeUndefined()
  })
})

describe("isMatchingSecret", () => {
  test("matches equal values and rejects mismatches", () => {
    expect(isMatchingSecret("secret", "secret")).toBe(true)
    expect(isMatchingSecret("secret", "other")).toBe(false)
    expect(isMatchingSecret(undefined, "secret")).toBe(false)
  })
})

