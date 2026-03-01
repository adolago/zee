import { isIP } from "node:net"

export type UrlPolicyOptions = {
  /**
   * Allow localhost hostnames (`localhost`, `*.localhost`).
   */
  allowLocalhost?: boolean
  /**
   * Allow private, loopback, and link-local network targets.
   */
  allowPrivateNetworks?: boolean
}

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase().replace(/\.$/, "")
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function isIpv4MappedIpv6(hostname: string): string | undefined {
  const lower = hostname.toLowerCase()
  if (!lower.startsWith("::ffff:")) return undefined
  const mapped = lower.slice("::ffff:".length)
  if (isIP(mapped) === 4) return mapped
  return tryParseHexMappedIpv4(mapped)
}

function tryParseHexMappedIpv4(mapped: string): string | undefined {
  const parts = mapped.split(":")
  if (parts.length !== 2) return undefined
  if (!parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) return undefined

  const high = Number.parseInt(parts[0], 16)
  const low = Number.parseInt(parts[1], 16)
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return undefined
  }

  const octets = [high >> 8, high & 0xff, low >> 8, low & 0xff]
  return octets.join(".")
}

function classifyIpv4(hostname: string): string | undefined {
  const parts = hostname.split(".")
  if (parts.length !== 4) return "invalid-ipv4"
  const octets = parts.map((part) => Number.parseInt(part, 10))
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return "invalid-ipv4"

  const [a, b] = octets
  if (a === 0) return "ipv4-unspecified"
  if (a === 10) return "ipv4-private-10/8"
  if (a === 127) return "ipv4-loopback"
  if (a === 169 && b === 254) return "ipv4-link-local"
  if (a === 172 && b >= 16 && b <= 31) return "ipv4-private-172.16/12"
  if (a === 192 && b === 168) return "ipv4-private-192.168/16"
  if (a === 100 && b >= 64 && b <= 127) return "ipv4-shared-100.64/10"
  if (a === 198 && (b === 18 || b === 19)) return "ipv4-benchmark-198.18/15"
  if (a >= 224 && a <= 239) return "ipv4-multicast"
  if (a >= 240) return "ipv4-reserved"
  return undefined
}

function classifyIpv6(hostname: string): string | undefined {
  const lower = normalizeHostname(hostname)
  const zoneIndex = lower.indexOf("%")
  const host = zoneIndex >= 0 ? lower.slice(0, zoneIndex) : lower

  if (host === "::") return "ipv6-unspecified"
  if (host === "::1") return "ipv6-loopback"
  if (host.startsWith("ff")) return "ipv6-multicast"
  if (host.startsWith("fc") || host.startsWith("fd")) return "ipv6-ula"
  if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) {
    return "ipv6-link-local"
  }

  const mappedIpv4 = isIpv4MappedIpv6(host)
  if (mappedIpv4) {
    const reason = classifyIpv4(mappedIpv4)
    if (reason) return `ipv4-mapped:${reason}`
  }

  return undefined
}

/**
 * Parse and validate an HTTP(S) URL.
 */
export function parseHttpTarget(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid URL: "${raw}"`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol for "${raw}". Only http/https URLs are supported.`)
  }
  if (!parsed.hostname) {
    throw new Error(`URL is missing hostname: "${raw}"`)
  }
  return parsed
}

/**
 * Check whether a hostname should be blocked for outbound requests.
 */
export function isForbiddenAddress(
  hostname: string,
  options: UrlPolicyOptions = {},
): { forbidden: boolean; reason?: string } {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return { forbidden: true, reason: "empty-hostname" }

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    if (options.allowLocalhost) return { forbidden: false }
    return { forbidden: true, reason: "localhost" }
  }

  const ipType = isIP(normalized)
  if (ipType === 4) {
    const reason = classifyIpv4(normalized)
    if (!reason) return { forbidden: false }
    if (reason === "ipv4-multicast" || reason === "ipv4-unspecified") {
      return { forbidden: true, reason }
    }
    if (options.allowPrivateNetworks) return { forbidden: false }
    return { forbidden: true, reason }
  }

  if (ipType === 6) {
    const reason = classifyIpv6(normalized)
    if (!reason) return { forbidden: false }
    if (reason === "ipv6-multicast" || reason === "ipv6-unspecified") {
      return { forbidden: true, reason }
    }
    if (options.allowPrivateNetworks) return { forbidden: false }
    return { forbidden: true, reason }
  }

  return { forbidden: false }
}

/**
 * Parse and enforce URL outbound policy.
 */
export function assertSafeOutboundUrl(raw: string, options: UrlPolicyOptions = {}): URL {
  const parsed = parseHttpTarget(raw)
  const verdict = isForbiddenAddress(parsed.hostname, options)
  if (verdict.forbidden) {
    throw new Error(`Blocked URL target "${parsed.hostname}" (${verdict.reason ?? "forbidden"})`)
  }
  return parsed
}
