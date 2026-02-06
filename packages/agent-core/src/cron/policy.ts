import { Config } from "@/config/config"

const DEFAULT_TOOL_INVOKE_ALLOWLIST = ["zee-banner-refresh"]

function parseCommaList(value?: string): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export async function getCronToolInvokeAllowlist(): Promise<Set<string>> {
  const config = await Config.global().catch(() => ({} as Config.Info))
  const fromConfig = config?.cron?.toolInvokeAllowlist ?? []
  const fromEnv = parseCommaList(process.env["AGENT_CORE_CRON_TOOL_INVOKE_ALLOWLIST"])

  const allowlist = [
    ...DEFAULT_TOOL_INVOKE_ALLOWLIST,
    ...fromConfig,
    ...fromEnv,
  ]
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0)

  return new Set(allowlist)
}

export async function isCronToolInvokeAllowed(tool: string): Promise<boolean> {
  const allowlist = await getCronToolInvokeAllowlist()
  if (allowlist.has("*")) return true
  return allowlist.has(tool)
}

export async function assertCronToolInvokeAllowed(tool: string): Promise<void> {
  if (await isCronToolInvokeAllowed(tool)) return
  throw new Error(
    `cron toolInvoke is not allowed for tool "${tool}". Add it to config.cron.toolInvokeAllowlist or set AGENT_CORE_CRON_TOOL_INVOKE_ALLOWLIST.`,
  )
}

