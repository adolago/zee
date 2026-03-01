import { timingSafeEqual } from "./timing-safe.js"

export type BasicCredentials = {
  username: string
  password: string
}

/**
 * Extract bearer token value from an Authorization header.
 */
export function extractBearerToken(authorizationHeader: string | null | undefined): string | undefined {
  if (!authorizationHeader) return undefined
  const match = authorizationHeader.trim().match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  return token ? token : undefined
}

/**
 * Parse HTTP Basic credentials from an Authorization header.
 */
export function extractBasicCredentials(authorizationHeader: string | null | undefined): BasicCredentials | undefined {
  if (!authorizationHeader) return undefined

  const match = authorizationHeader.trim().match(/^Basic\s+(.+)$/i)
  if (!match?.[1]) return undefined

  let decoded: string
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf-8")
  } catch {
    return undefined
  }

  const separatorIndex = decoded.indexOf(":")
  if (separatorIndex < 0) return undefined

  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1),
  }
}

/**
 * Resolve gateway route secret from headers.
 * Priority:
 * 1) x-zee-gateway-token
 * 2) Authorization: Bearer <token>
 */
export function extractGatewayRouteSecret(headers: Headers): string | undefined {
  const directHeader = headers.get("x-zee-gateway-token")?.trim()
  if (directHeader) return directHeader
  return extractBearerToken(headers.get("authorization"))
}

/**
 * Constant-time secret validation helper.
 */
export function isMatchingSecret(providedSecret: string | undefined, expectedSecret: string): boolean {
  if (!providedSecret) return false
  return timingSafeEqual(providedSecret, expectedSecret)
}

