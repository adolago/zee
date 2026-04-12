import { describe, expect, test } from "bun:test"
import {
  getOpenBBFreeProvider,
  OPENBB_FREE_PROVIDERS,
  providersRequiringCredentials,
} from "../../src/openbb/free-providers"

describe("OpenBB free provider catalog", () => {
  test("includes free DCM research providers and excludes paid providers", () => {
    const ids = OPENBB_FREE_PROVIDERS.map((provider) => provider.id)

    expect(ids).toContain("fred")
    expect(ids).toContain("sec")
    expect(ids).toContain("fmp")
    expect(ids).toContain("tiingo")
    expect(ids).toContain("tradier")
    expect(ids).not.toContain("benzinga")
    expect(ids).not.toContain("intrinio")
    expect(ids).not.toContain("tradingeconomics")
  })

  test("marks Tradier as sandbox-only by default", () => {
    const tradier = getOpenBBFreeProvider("tradier")

    expect(tradier?.kind).toBe("free-sandbox")
    expect(tradier?.openbbExtraCredentials?.tradier_account_type).toBe("sandbox")
  })

  test("credential-backed providers expose OpenBB credential names where needed", () => {
    const credentialProviders = providersRequiringCredentials()
    const fred = credentialProviders.find((provider) => provider.id === "fred")

    expect(fred?.envKey).toBe("FRED_API_KEY")
    expect(fred?.openbbKey).toBe("fred_api_key")
  })
})
