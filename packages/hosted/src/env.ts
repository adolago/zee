import path from "path"

const toNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback
  return value === "true" || value === "1" || value === "yes"
}

const toCsv = (value: string | undefined) => {
  if (!value) return [] as string[]
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const host = process.env.HOSTED_HOST ?? "127.0.0.1"
const port = toNumber(process.env.HOSTED_PORT, 8787)
const dataDir = process.env.HOSTED_DATA_DIR ?? path.join(process.cwd(), "data")

export const env = {
  HOST: host,
  PORT: port,
  BASE_URL: process.env.HOSTED_BASE_URL ?? `http://${host}:${port}`,
  DATA_DIR: dataDir,
  DB_PATH: process.env.HOSTED_DB_PATH ?? path.join(dataDir, "hosted.db"),
  SESSION_TTL_HOURS: toNumber(process.env.HOSTED_SESSION_TTL_HOURS, 24 * 7),
  SHARE_TTL_HOURS: toNumber(process.env.HOSTED_SHARE_TTL_HOURS, 24 * 30),
  ALLOW_SIGNUP: toBool(process.env.HOSTED_ALLOW_SIGNUP, true),
  API_KEYS: toCsv(process.env.HOSTED_API_KEYS ?? process.env.HOSTED_API_KEY),
  CORS_ORIGINS: toCsv(process.env.HOSTED_CORS_ORIGINS),
  VAULT_KEY: process.env.HOSTED_VAULT_KEY ?? "",
  RATE_LIMIT_PER_MINUTE: toNumber(process.env.HOSTED_RATE_LIMIT_PER_MINUTE, 60),
  RETENTION_LOGS_DAYS: toNumber(process.env.HOSTED_RETENTION_LOGS_DAYS, 30),
  BILLING_PORTAL_URL: process.env.HOSTED_BILLING_PORTAL_URL ?? "",
  DEFAULT_PLAN: process.env.HOSTED_DEFAULT_PLAN ?? "free",
}

export const envUtils = {
  toCsv,
  toNumber,
  toBool,
}
