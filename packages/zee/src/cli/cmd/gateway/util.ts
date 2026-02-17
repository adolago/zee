import { resolveEmbeddedGatewayPort } from "@/gateway/embedded-gateway"

export function resolveGatewayWsUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ZEE_GATEWAY_URL?.trim()
  if (override) return override
  const port = resolveEmbeddedGatewayPort()
  return `ws://127.0.0.1:${port}`
}
