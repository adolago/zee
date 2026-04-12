import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import * as prompts from "@clack/prompts"
import { Auth } from "../../auth"
import { Global } from "../../global"
import {
  getOpenBBFreeProvider,
  OPENBB_FREE_PROVIDERS,
  providersRequiringCredentials,
  type OpenBBFreeProvider,
} from "../../openbb/free-providers"
import { writeOpenBBCredentials } from "../../openbb/user-settings"
import { cmd } from "./cmd"

type AuthAcquireArgs = {
  provider?: string
  key?: string
  "free-only"?: boolean
  openbb?: boolean
  scope?: "user" | "machine"
  "dry-run"?: boolean
  json?: boolean
  browser?: boolean
  "wait-ms"?: number
  "non-interactive"?: boolean
}

type AuthAcquireResult = {
  provider: string
  providerName: string
  openedUrl?: string
  detected: boolean
  prompted: boolean
  saved: boolean
  dryRun: boolean
  authStoreProvider?: string
  openbb?: {
    path: string
    keys: string[]
    written: boolean
  }
  reportPath?: string
  message: string
}

function browserBaseUrl(): string {
  const host = process.env.ZEE_BROWSER_HOST || "127.0.0.1"
  const port = Number.parseInt(process.env.ZEE_BROWSER_PORT || "", 10) || 18791
  return `http://${host}:${port}`
}

async function browserApi(method: string, endpoint: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${browserBaseUrl()}${endpoint}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(2500),
  })
  if (!response.ok) throw new Error(`Browser API ${response.status}`)
  const contentType = response.headers.get("content-type") ?? ""
  return contentType.includes("json") ? response.json() : response.text()
}

function openWithDefaultBrowser(url: string): void {
  const command =
    process.platform === "win32"
      ? { file: "cmd.exe", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] }
  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  child.unref()
}

async function openProviderPage(provider: OpenBBFreeProvider, useBrowser: boolean): Promise<boolean> {
  if (!useBrowser) return false
  try {
    await browserApi("POST", "/start")
    await browserApi("POST", "/tabs/open", { url: provider.website })
    return true
  } catch {
    openWithDefaultBrowser(provider.website)
    return false
  }
}

function detectApiKeys(text: string): string[] {
  const candidates = new Set<string>()
  const patterns = [
    /\b[A-Za-z0-9_-]{24,96}\b/g,
    /\b[A-Fa-f0-9]{32,96}\b/g,
    /\bpk_[A-Za-z0-9_-]{16,96}\b/g,
    /\bsk_[A-Za-z0-9_-]{16,96}\b/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0]
      if (/^(http|https|copyright|javascript)$/i.test(value)) continue
      candidates.add(value)
    }
  }
  return Array.from(candidates)
}

async function detectKeyFromBrowser(waitMs: number): Promise<string | undefined> {
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  try {
    const snapshot = await browserApi("POST", "/snapshot", { format: "ai", maxChars: 20000 })
    const text = typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot)
    const keys = detectApiKeys(text)
    return keys.length === 1 ? keys[0] : undefined
  } catch {
    return undefined
  }
}

function redacted(value: string): string {
  if (value.length <= 8) return "********"
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

async function appendAcquisitionReport(result: AuthAcquireResult): Promise<string> {
  const reportPath = path.join(Global.Path.workspace, "research", "provider-credentials.md")
  const lines = [
    `## ${new Date().toISOString()} - ${result.providerName}`,
    "",
    `- Provider: ${result.provider}`,
    `- Opened: ${result.openedUrl ?? "not opened"}`,
    `- Detected key: ${result.detected ? "yes" : "no"}`,
    `- Prompted: ${result.prompted ? "yes" : "no"}`,
    `- Saved: ${result.saved ? "yes" : "no"}`,
    `- OpenBB keys: ${result.openbb?.keys.join(", ") || "none"}`,
    "",
  ]
  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.appendFile(reportPath, lines.join("\n"), "utf-8")
  return reportPath
}

function providerOptions() {
  return OPENBB_FREE_PROVIDERS.map((provider) => ({
    label: provider.name,
    value: provider.id,
    hint: provider.kind === "no-key" ? "no key" : provider.kind.replace("-", " "),
  }))
}

async function chooseProvider(args: AuthAcquireArgs): Promise<OpenBBFreeProvider | undefined> {
  if (args.provider) {
    const provider = getOpenBBFreeProvider(args.provider)
    if (!provider) throw new Error(`Unknown free OpenBB provider: ${args.provider}`)
    return provider
  }
  if (args.json || args["non-interactive"]) return undefined
  const selected = await prompts.autocomplete({
    message: "Select free OpenBB provider",
    maxItems: 10,
    options: providerOptions(),
  })
  if (prompts.isCancel(selected)) throw new Error("Cancelled")
  return getOpenBBFreeProvider(String(selected))
}

export async function runAuthAcquire(input: AuthAcquireArgs): Promise<AuthAcquireResult | OpenBBFreeProvider[]> {
  const provider = await chooseProvider(input)
  if (!provider) return OPENBB_FREE_PROVIDERS

  if (!provider.envKey && !provider.openbbKey) {
    const result: AuthAcquireResult = {
      provider: provider.id,
      providerName: provider.name,
      openedUrl: provider.website,
      detected: false,
      prompted: false,
      saved: false,
      dryRun: Boolean(input["dry-run"]),
      message: `${provider.name} does not require a saved API key.`,
    }
    if (!input["dry-run"]) {
      await openProviderPage(provider, input.browser !== false)
      result.reportPath = await appendAcquisitionReport(result)
    }
    return result
  }

  let key = input.key?.trim()
  let detected = false
  let prompted = false
  let opened = false
  if (!input["dry-run"] && !key) {
    opened = await openProviderPage(provider, input.browser !== false)
    key = await detectKeyFromBrowser(input["wait-ms"] ?? 2000)
    detected = Boolean(key)
  }

  if (!key && !input["non-interactive"] && !input.json) {
    const entered = await prompts.password({
      message: `Enter ${provider.envKey ?? provider.openbbKey}`,
      validate: (value) => (value && value.trim().length > 0 ? undefined : "Required"),
    })
    if (prompts.isCancel(entered)) throw new Error("Cancelled")
    key = String(entered).trim()
    prompted = true
  }

  if (!key) {
    return {
      provider: provider.id,
      providerName: provider.name,
      openedUrl: provider.website,
      detected,
      prompted,
      saved: false,
      dryRun: Boolean(input["dry-run"]),
      message: `No key captured for ${provider.name}.`,
    }
  }

  const openbbCredentials = [
    ...(provider.openbbKey ? [{ key: provider.openbbKey, value: key }] : []),
    ...Object.entries(provider.openbbExtraCredentials ?? {}).map(([extraKey, value]) => ({ key: extraKey, value })),
  ]

  const openbb = await writeOpenBBCredentials(openbbCredentials, {
    scope: input.scope ?? "user",
    dryRun: Boolean(input["dry-run"]) || input.openbb === false,
  })

  if (!input["dry-run"] && provider.envKey) {
    await Auth.set(provider.id, { type: "api", key })
  }

  const result: AuthAcquireResult = {
    provider: provider.id,
    providerName: provider.name,
    openedUrl: provider.website,
    detected,
    prompted,
    saved: !input["dry-run"],
    dryRun: Boolean(input["dry-run"]),
    authStoreProvider: provider.envKey ? provider.id : undefined,
    openbb,
    message: `${provider.name} credential ${input["dry-run"] ? "would be saved" : "saved"} (${redacted(key)}).`,
  }
  if (!input["dry-run"]) {
    result.reportPath = await appendAcquisitionReport(result)
  }
  if (!opened && !input["dry-run"] && input.browser !== false) {
    result.message += " Browser control was unavailable, so the default browser was used."
  }
  return result
}

export const AuthAcquireCommand = cmd({
  command: "acquire [provider]",
  describe: "open free provider pages and save OpenBB-compatible credentials",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        type: "string",
        describe: "Free provider ID such as fred, fmp, sec, tiingo, or yfinance",
      })
      .option("key", { type: "string", describe: "Credential value to save without prompting" })
      .option("free-only", { type: "boolean", default: true, describe: "Restrict catalog to free providers" })
      .option("openbb", { type: "boolean", default: true, describe: "Also write OpenBB user_settings.json" })
      .option("scope", { type: "string", choices: ["user", "machine"], default: "user" })
      .option("browser", {
        type: "boolean",
        default: true,
        describe: "Open provider page in Zee browser/default browser",
      })
      .option("wait-ms", {
        type: "number",
        default: 2000,
        describe: "Wait before one browser snapshot key-detection pass",
      })
      .option("dry-run", { type: "boolean", default: false })
      .option("json", { type: "boolean", default: false })
      .option("non-interactive", { type: "boolean", default: false }),
  async handler(args) {
    const result = await runAuthAcquire(args as AuthAcquireArgs)
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    if (Array.isArray(result)) {
      for (const provider of result) {
        console.log(`${provider.id}\t${provider.name}\t${provider.kind}`)
      }
      return
    }
    prompts.log.success(result.message)
    if (result.openbb?.keys.length) prompts.log.info(`OpenBB: ${result.openbb.path}`)
    if (result.reportPath) prompts.log.info(`Report: ${result.reportPath}`)
  },
})
