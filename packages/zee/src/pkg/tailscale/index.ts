/**
 * Shared Tailscale Utilities
 *
 * Extracted from packages/zee/Swabble/src/infra/tailscale.ts to be
 * shared between the zee daemon and the Zee gateway. Both can
 * now expose their HTTP servers via Tailscale Serve or Funnel.
 *
 * The Zee-specific tailscale.ts remains as a thin wrapper that imports
 * from this module plus adds Zee-specific prompts and logging.
 */

import { existsSync } from "node:fs"
import { exec as execCb } from "node:child_process"
import { promisify } from "node:util"

const execAsync = promisify(execCb)

export type TailscaleMode = "off" | "serve" | "funnel"

export interface TailscaleExposureResult {
  mode: TailscaleMode
  hostname?: string
  cleanup: () => Promise<void>
}

function parsePossiblyNoisyJsonObject(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
  }
  return JSON.parse(trimmed) as Record<string, unknown>
}

/**
 * Find the tailscale binary in PATH.
 */
export async function findTailscaleBinary(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("which tailscale", { timeout: 3000 })
    const binary = stdout.trim()
    if (binary && existsSync(binary)) return binary
  } catch {
    // not found
  }
  return null
}

let cachedBinary: string | null | undefined

/**
 * Cached tailscale binary lookup.
 */
export async function getTailscaleBinary(): Promise<string | null> {
  if (cachedBinary !== undefined) return cachedBinary
  cachedBinary = await findTailscaleBinary()
  return cachedBinary
}

/**
 * Get the tailnet hostname from `tailscale status --json`.
 */
export async function getTailnetHostname(binary?: string): Promise<string | null> {
  const bin = binary ?? (await getTailscaleBinary())
  if (!bin) return null

  try {
    const { stdout } = await execAsync(`${bin} status --json`, { timeout: 5000 })
    const parsed = parsePossiblyNoisyJsonObject(stdout)
    const self = typeof parsed.Self === "object" && parsed.Self !== null
      ? (parsed.Self as Record<string, unknown>)
      : undefined
    const dns = typeof self?.DNSName === "string" ? (self.DNSName as string) : undefined
    const ips = Array.isArray(self?.TailscaleIPs)
      ? (self.TailscaleIPs as string[])
      : []
    if (dns && dns.length > 0) return dns.replace(/\.$/, "")
    if (ips.length > 0) return ips[0]
  } catch {
    // tailscale not running or not accessible
  }
  return null
}

/**
 * Enable Tailscale Serve for a local port.
 */
export async function enableTailscaleServe(port: number, binary?: string): Promise<boolean> {
  const bin = binary ?? (await getTailscaleBinary())
  if (!bin) return false

  try {
    await execAsync(`${bin} serve --bg https+insecure://localhost:${port}`, { timeout: 10000 })
    return true
  } catch (err) {
    // Try with sudo if permission denied
    const errMsg = String(err)
    if (errMsg.includes("permission denied") || errMsg.includes("EPERM")) {
      try {
        await execAsync(`sudo ${bin} serve --bg https+insecure://localhost:${port}`, { timeout: 15000 })
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

/**
 * Disable Tailscale Serve.
 */
export async function disableTailscaleServe(binary?: string): Promise<boolean> {
  const bin = binary ?? (await getTailscaleBinary())
  if (!bin) return false

  try {
    await execAsync(`${bin} serve --remove / 2>/dev/null || true`, { timeout: 10000 })
    return true
  } catch {
    return false
  }
}

/**
 * Enable Tailscale Funnel for a local port.
 */
export async function enableTailscaleFunnel(port: number, binary?: string): Promise<boolean> {
  const bin = binary ?? (await getTailscaleBinary())
  if (!bin) return false

  try {
    await execAsync(`${bin} funnel --bg https+insecure://localhost:${port}`, { timeout: 10000 })
    return true
  } catch (err) {
    const errMsg = String(err)
    if (errMsg.includes("permission denied") || errMsg.includes("EPERM")) {
      try {
        await execAsync(`sudo ${bin} funnel --bg https+insecure://localhost:${port}`, { timeout: 15000 })
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

/**
 * Disable Tailscale Funnel.
 */
export async function disableTailscaleFunnel(binary?: string): Promise<boolean> {
  const bin = binary ?? (await getTailscaleBinary())
  if (!bin) return false

  try {
    await execAsync(`${bin} funnel --remove / 2>/dev/null || true`, { timeout: 10000 })
    return true
  } catch {
    return false
  }
}

/**
 * Start Tailscale exposure for a daemon or gateway.
 * Returns a cleanup function to tear down on exit.
 */
export async function startTailscaleExposure(params: {
  mode: TailscaleMode
  port: number
  onInfo?: (msg: string) => void
  onWarn?: (msg: string) => void
}): Promise<TailscaleExposureResult | null> {
  const { mode, port, onInfo, onWarn } = params

  if (mode === "off") return null

  const binary = await getTailscaleBinary()
  if (!binary) {
    onWarn?.("Tailscale binary not found; skipping exposure")
    return null
  }

  const hostname = await getTailnetHostname(binary)

  let enabled = false
  if (mode === "serve") {
    enabled = await enableTailscaleServe(port, binary)
  } else if (mode === "funnel") {
    enabled = await enableTailscaleFunnel(port, binary)
  }

  if (!enabled) {
    onWarn?.(`Failed to enable Tailscale ${mode} on port ${port}`)
    return null
  }

  const tsUrl = hostname ? `https://${hostname}` : undefined
  onInfo?.(`Tailscale ${mode} active${tsUrl ? ` at ${tsUrl}` : ""} -> localhost:${port}`)

  const cleanup = async () => {
    try {
      if (mode === "serve") {
        await disableTailscaleServe(binary)
      } else if (mode === "funnel") {
        await disableTailscaleFunnel(binary)
      }
    } catch {
      // cleanup failures are non-fatal
    }
  }

  return { mode, hostname: hostname ?? undefined, cleanup }
}
