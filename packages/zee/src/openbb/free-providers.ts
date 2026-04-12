export type FreeProviderKind = "no-key" | "free-registration" | "free-tier" | "free-sandbox"

export type OpenBBFreeProvider = {
  id: string
  name: string
  kind: FreeProviderKind
  website: string
  envKey?: string
  envAliases?: string[]
  openbbKey?: string
  openbbExtraCredentials?: Record<string, string>
  notes?: string
}

export const OPENBB_FREE_PROVIDERS: OpenBBFreeProvider[] = [
  {
    id: "sec",
    name: "SEC EDGAR",
    kind: "free-registration",
    website: "https://www.sec.gov/edgar/sec-api-documentation",
    envKey: "SEC_IDENTITY",
    notes: "Use a real email/user-agent identity; OpenBB SEC endpoints do not require a provider API key.",
  },
  {
    id: "fred",
    name: "FRED",
    kind: "free-registration",
    website: "https://fredaccount.stlouisfed.org/apikeys",
    envKey: "FRED_API_KEY",
    openbbKey: "fred_api_key",
  },
  {
    id: "bls",
    name: "BLS",
    kind: "free-registration",
    website: "https://www.bls.gov/developers/",
    envKey: "BLS_API_KEY",
    openbbKey: "bls_api_key",
  },
  {
    id: "congress-gov",
    name: "Congress.gov",
    kind: "free-registration",
    website: "https://api.congress.gov/sign-up/",
    envKey: "CONGRESS_GOV_API_KEY",
    openbbKey: "congress_gov_api_key",
  },
  {
    id: "cftc",
    name: "CFTC",
    kind: "free-registration",
    website: "https://publicreporting.cftc.gov/",
    envKey: "CFTC_APP_TOKEN",
    openbbKey: "cftc_app_token",
  },
  {
    id: "eia",
    name: "EIA",
    kind: "free-registration",
    website: "https://www.eia.gov/opendata/register.php",
    envKey: "EIA_API_KEY",
    openbbKey: "eia_api_key",
  },
  {
    id: "alpha-vantage",
    name: "Alpha Vantage",
    kind: "free-tier",
    website: "https://www.alphavantage.co/support/#api-key",
    envKey: "ALPHA_VANTAGE_API_KEY",
    openbbKey: "alpha_vantage_api_key",
  },
  {
    id: "biztoc",
    name: "Biztoc",
    kind: "free-tier",
    website: "https://api.biztoc.com/",
    envKey: "BIZTOC_API_KEY",
    openbbKey: "biztoc_api_key",
  },
  {
    id: "econdb",
    name: "EconDB",
    kind: "free-tier",
    website: "https://www.econdb.com/",
    envKey: "ECONDB_API_KEY",
    openbbKey: "econdb_api_key",
  },
  {
    id: "fmp",
    name: "Financial Modeling Prep",
    kind: "free-tier",
    website: "https://site.financialmodelingprep.com/developer/docs",
    envKey: "FMP_API_KEY",
    openbbKey: "fmp_api_key",
  },
  {
    id: "nasdaq",
    name: "Nasdaq Data Link",
    kind: "free-tier",
    website: "https://data.nasdaq.com/sign-up",
    envKey: "NASDAQ_API_KEY",
    openbbKey: "nasdaq_api_key",
  },
  {
    id: "polygon",
    name: "Polygon.io",
    kind: "free-tier",
    website: "https://polygon.io/dashboard/api-keys",
    envKey: "POLYGON_API_KEY",
    openbbKey: "polygon_api_key",
  },
  {
    id: "tiingo",
    name: "Tiingo",
    kind: "free-tier",
    website: "https://www.tiingo.com/account/api/token",
    envKey: "TIINGO_TOKEN",
    openbbKey: "tiingo_token",
  },
  {
    id: "tradier",
    name: "Tradier Sandbox",
    kind: "free-sandbox",
    website: "https://developer.tradier.com/",
    envKey: "TRADIER_API_KEY",
    envAliases: ["TRADIER_TOKEN"],
    openbbKey: "tradier_api_key",
    openbbExtraCredentials: { tradier_account_type: "sandbox" },
    notes: "Zee defaults Tradier to sandbox credentials only.",
  },
  { id: "ecb", name: "ECB", kind: "no-key", website: "https://data.ecb.europa.eu/" },
  { id: "imf", name: "IMF", kind: "no-key", website: "https://data.imf.org/" },
  {
    id: "federal-reserve",
    name: "Federal Reserve",
    kind: "no-key",
    website: "https://www.federalreserve.gov/data.htm",
  },
  { id: "government-us", name: "US Government", kind: "no-key", website: "https://data.gov/" },
  { id: "oecd", name: "OECD", kind: "no-key", website: "https://data.oecd.org/" },
  { id: "cboe", name: "Cboe", kind: "no-key", website: "https://www.cboe.com/" },
  { id: "deribit", name: "Deribit", kind: "no-key", website: "https://docs.deribit.com/" },
  {
    id: "famafrench",
    name: "Fama-French",
    kind: "no-key",
    website: "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html",
  },
  { id: "finra", name: "FINRA", kind: "no-key", website: "https://www.finra.org/" },
  { id: "finviz", name: "Finviz", kind: "no-key", website: "https://finviz.com/" },
  { id: "seeking-alpha", name: "Seeking Alpha", kind: "no-key", website: "https://seekingalpha.com/" },
  { id: "tmx", name: "TMX", kind: "no-key", website: "https://money.tmx.com/" },
  { id: "yfinance", name: "Yahoo Finance", kind: "no-key", website: "https://finance.yahoo.com/" },
]

export function getOpenBBFreeProvider(id: string): OpenBBFreeProvider | undefined {
  const normalized = id.trim().toLowerCase()
  return OPENBB_FREE_PROVIDERS.find((provider) => provider.id === normalized)
}

export function providersRequiringCredentials(): OpenBBFreeProvider[] {
  return OPENBB_FREE_PROVIDERS.filter((provider) => Boolean(provider.envKey || provider.openbbKey))
}
