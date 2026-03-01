import { describe, expect, test } from "bun:test"
import { assertSafeOutboundUrl, isForbiddenAddress } from "../../src/security/url-policy.js"

describe("url policy", () => {
  test("allows public http/https URLs", () => {
    expect(assertSafeOutboundUrl("https://example.com/docs").toString()).toBe("https://example.com/docs")
    expect(assertSafeOutboundUrl("http://example.com").toString()).toBe("http://example.com/")
  })

  test("rejects non-http protocols", () => {
    expect(() => assertSafeOutboundUrl("ftp://example.com/file")).toThrow(/Unsupported URL protocol/)
  })

  test("rejects localhost and private IPv4 by default", () => {
    expect(() => assertSafeOutboundUrl("http://localhost:8080")).toThrow(/Blocked URL target/)
    expect(() => assertSafeOutboundUrl("http://127.0.0.1:8080")).toThrow(/Blocked URL target/)
    expect(() => assertSafeOutboundUrl("http://192.168.1.10:8080")).toThrow(/Blocked URL target/)
  })

  test("rejects IPv6 special-use and multicast ranges by default", () => {
    expect(() => assertSafeOutboundUrl("http://[::1]/")).toThrow(/Blocked URL target/)
    expect(() => assertSafeOutboundUrl("http://[fe80::1]/")).toThrow(/Blocked URL target/)
    expect(() => assertSafeOutboundUrl("http://[fd12:3456::1]/")).toThrow(/Blocked URL target/)
    expect(() => assertSafeOutboundUrl("http://[ff02::1]/")).toThrow(/Blocked URL target/)
    expect(() => assertSafeOutboundUrl("http://[::ffff:192.168.1.2]/")).toThrow(/Blocked URL target/)
  })

  test("allows local/private targets only when explicitly permitted", () => {
    expect(
      assertSafeOutboundUrl("http://localhost:3210", {
        allowLocalhost: true,
        allowPrivateNetworks: true,
      }).toString(),
    ).toBe("http://localhost:3210/")

    expect(
      assertSafeOutboundUrl("http://127.0.0.1:3210", {
        allowPrivateNetworks: true,
      }).toString(),
    ).toBe("http://127.0.0.1:3210/")
  })

  test("always denies multicast and unspecified", () => {
    const multicast4 = isForbiddenAddress("224.0.0.10", { allowPrivateNetworks: true })
    expect(multicast4.forbidden).toBe(true)
    expect(multicast4.reason).toBe("ipv4-multicast")

    const multicast6 = isForbiddenAddress("ff02::1", { allowPrivateNetworks: true })
    expect(multicast6.forbidden).toBe(true)
    expect(multicast6.reason).toBe("ipv6-multicast")

    const unspecified = isForbiddenAddress("::", { allowPrivateNetworks: true })
    expect(unspecified.forbidden).toBe(true)
    expect(unspecified.reason).toBe("ipv6-unspecified")
  })
})

