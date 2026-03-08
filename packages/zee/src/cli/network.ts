import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "../config/config"
import { assertSafeServerBind } from "../server/auth"

const options = {
  port: {
    type: "number" as const,
    describe: "port to listen on",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery",
    default: false,
  },
  "mdns-domain": {
    type: "string" as const,
    describe: "custom domain name for mDNS service discovery",
    default: "zee.local",
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>

/**
 * mDNS configuration - supports both boolean shorthand and detailed object.
 * The CLI only provides boolean, but config files can specify detailed options.
 */
export type MdnsConfig = boolean | { enabled?: boolean; minimal?: boolean }

/**
 * Resolved network options with potentially enhanced mdns config.
 * The mdns field may be an object if coming from config file.
 */
export type ResolvedNetworkOptions = {
  hostname: string
  port: number
  mdns: MdnsConfig
  mdnsDomain: string
  cors: string[]
}

function parseCorsEnv(value?: string): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

export async function resolveNetworkOptions(args: NetworkOptions) {
  const config = await Config.global()
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const mdnsDomainExplicitlySet =
    process.argv.includes("--mdns-domain") || process.argv.some((arg) => arg.startsWith("--mdns-domain="))
  const corsExplicitlySet = process.argv.includes("--cors")

  // mDNS config can be boolean (from CLI) or object (from config file)
  // If CLI flag is set, it overrides config; otherwise use config (preserving object form)
  const mdns: MdnsConfig = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = mdnsDomainExplicitlySet
    ? (args["mdns-domain"] as string)
    : ((config?.server?.mdnsDomain as string | undefined) ?? (args["mdns-domain"] as string))

  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet ? args.hostname : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const trustedOrigins = Array.isArray(config?.gateway?.controlUi?.trustedOrigins)
    ? config.gateway.controlUi.trustedOrigins.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
  const envCors = [
    ...parseCorsEnv(process.env["ZEE_CORS_ALLOWLIST"]),
    ...parseCorsEnv(process.env["ZEE_HOSTED_ORIGINS"]),
    ...parseCorsEnv(process.env["ZEE_CORS_ORIGINS"]),
  ]
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...trustedOrigins, ...envCors, ...argsCors]

  assertSafeServerBind({ hostname, config })

  return { hostname, port, mdns, mdnsDomain, cors }
}
