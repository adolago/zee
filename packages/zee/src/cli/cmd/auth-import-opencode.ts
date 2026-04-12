import * as prompts from "@clack/prompts"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { applyEdits, modify, parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser"
import { Auth } from "../../auth"
import { cmd } from "./cmd"
import { UI } from "../ui"

type UnknownCategory = "topLevel" | "provider" | "models" | "server"

type ImportPlan = {
  configEdits: Map<string, { path: (string | number)[]; value: unknown }>
  authEntries: Record<string, Auth.Info>
  mapped: string[]
  skipped: string[]
  unknown: Record<UnknownCategory, string[]>
}

export type OpencodeImportReport = {
  sourcePath: string
  targetConfigPath: string
  dryRun: boolean
  mapped: string[]
  skipped: string[]
  unknown: Record<UnknownCategory, string[]>
  authProviders: string[]
  configEditCount: number
}

const IMPORT_REMEDIATION: Record<UnknownCategory, string> = {
  topLevel: "Move to Zee TUI/web config docs; not part of auth/provider migration.",
  provider: "Keep auth/base URL/model overrides; move unsupported provider tuning to Zee provider policy.",
  models: "Keep models.url/models.path; convert unsupported model-routing keys to explicit Zee model selection.",
  server: "Keep server.port/hostname/cors/mdns*; move non-equivalent keys to Zee daemon/server flags.",
}

const ROOT_RECOGNIZED = new Set([
  "provider",
  "providers",
  "models",
  "server",
  "logLevel",
  "model",
  "small_model",
  "smallModel",
  "disabled_providers",
  "disabledProviders",
  "share",
  "autoupdate",
  "autoUpdate",
  "username",
])

const PROVIDER_RECOGNIZED = new Set([
  "apiKey",
  "key",
  "token",
  "baseURL",
  "baseUrl",
  "url",
  "enterpriseUrl",
  "timeout",
  "setCacheKey",
  "whitelist",
  "allowlist",
  "models",
  "options",
  "oauth",
  "tokens",
  "auth",
  "access",
  "accessToken",
  "refresh",
  "refreshToken",
  "expires",
  "accountId",
  "id",
  "name",
  "type",
])

const PROVIDER_OPTIONS_RECOGNIZED = new Set([
  "apiKey",
  "key",
  "token",
  "baseURL",
  "baseUrl",
  "enterpriseUrl",
  "timeout",
  "setCacheKey",
])

function initUnknown(): Record<UnknownCategory, string[]> {
  return {
    topLevel: [],
    provider: [],
    models: [],
    server: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const normalized = value.filter(hasString).map((item) => item.trim())
  return normalized.length > 0 ? normalized : undefined
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value)
}

function addUnknown(plan: ImportPlan, category: UnknownCategory, pathLabel: string) {
  pushUnique(plan.unknown[category], pathLabel)
}

function addMapped(plan: ImportPlan, pathLabel: string) {
  pushUnique(plan.mapped, pathLabel)
}

function addSkipped(plan: ImportPlan, message: string) {
  pushUnique(plan.skipped, message)
}

function setEdit(plan: ImportPlan, pathParts: (string | number)[], value: unknown) {
  const key = pathParts.join(".")
  plan.configEdits.set(key, { path: pathParts, value })
}

function getStringFromKeys(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (hasString(source[key])) return String(source[key]).trim()
  }
  return undefined
}

function getNumberFromKeys(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

function normalizeExpires(value: number): number {
  // OpenCode configs sometimes encode epoch seconds, Zee stores epoch ms.
  return value < 1_000_000_000_000 ? value * 1000 : value
}

function parseOauthFromRecord(input: Record<string, unknown>): Auth.Info | undefined {
  const refresh = getStringFromKeys(input, ["refresh", "refreshToken"])
  const access = getStringFromKeys(input, ["access", "accessToken"])
  const expiresRaw = getNumberFromKeys(input, ["expires", "expiry", "expiresAt"])
  if (!refresh || !access || typeof expiresRaw !== "number") return undefined
  const expires = normalizeExpires(expiresRaw)
  const accountId = getStringFromKeys(input, ["accountId"])
  if (accountId) {
    return {
      type: "oauth",
      refresh,
      access,
      expires,
      accountId,
    }
  }
  return {
    type: "oauth",
    refresh,
    access,
    expires,
  }
}

function extractAuthInfo(providerID: string, providerConfig: Record<string, unknown>, plan: ImportPlan) {
  const oauthCandidates: Array<Record<string, unknown>> = []
  for (const key of ["oauth", "tokens", "auth"]) {
    const candidate = providerConfig[key]
    if (isRecord(candidate)) oauthCandidates.push(candidate)
  }
  oauthCandidates.push(providerConfig)

  for (const candidate of oauthCandidates) {
    const oauth = parseOauthFromRecord(candidate)
    if (oauth) {
      plan.authEntries[providerID] = oauth
      addMapped(plan, `auth.${providerID}.oauth`)
      return
    }
  }

  let apiKey: string | undefined = getStringFromKeys(providerConfig, ["apiKey", "key", "token"])
  const options = isRecord(providerConfig.options) ? providerConfig.options : undefined
  if (!apiKey && options) {
    apiKey = getStringFromKeys(options, ["apiKey", "key", "token"])
  }
  if (!apiKey) {
    const authObject = isRecord(providerConfig.auth) ? providerConfig.auth : undefined
    if (authObject) apiKey = getStringFromKeys(authObject, ["apiKey", "key", "token"])
  }

  if (apiKey) {
    plan.authEntries[providerID] = {
      type: "api",
      key: apiKey,
    }
    addMapped(plan, `auth.${providerID}.api`)
  }
}

function mapProviderOptions(providerID: string, providerConfig: Record<string, unknown>, plan: ImportPlan) {
  const options = isRecord(providerConfig.options) ? providerConfig.options : {}
  if (isRecord(providerConfig.options)) {
    for (const key of Object.keys(options)) {
      if (!PROVIDER_OPTIONS_RECOGNIZED.has(key)) {
        addUnknown(plan, "provider", `providers.${providerID}.options.${key}`)
      }
    }
  }

  const baseURL = getStringFromKeys(
    {
      ...options,
      ...providerConfig,
    },
    ["baseURL", "baseUrl", "url"],
  )
  if (baseURL) {
    setEdit(plan, ["provider", providerID, "options", "baseURL"], baseURL)
    addMapped(plan, `provider.${providerID}.options.baseURL`)
  }

  const enterpriseUrl = getStringFromKeys(
    {
      ...options,
      ...providerConfig,
    },
    ["enterpriseUrl"],
  )
  if (enterpriseUrl) {
    setEdit(plan, ["provider", providerID, "options", "enterpriseUrl"], enterpriseUrl)
    addMapped(plan, `provider.${providerID}.options.enterpriseUrl`)
  }

  const timeoutValue = options.timeout ?? providerConfig.timeout
  if (typeof timeoutValue === "number" || timeoutValue === false) {
    setEdit(plan, ["provider", providerID, "options", "timeout"], timeoutValue)
    addMapped(plan, `provider.${providerID}.options.timeout`)
  } else if (timeoutValue !== undefined) {
    addSkipped(plan, `providers.${providerID}.timeout skipped (expected number|false)`)
  }

  const setCacheKeyValue = options.setCacheKey ?? providerConfig.setCacheKey
  if (typeof setCacheKeyValue === "boolean") {
    setEdit(plan, ["provider", providerID, "options", "setCacheKey"], setCacheKeyValue)
    addMapped(plan, `provider.${providerID}.options.setCacheKey`)
  } else if (setCacheKeyValue !== undefined) {
    addSkipped(plan, `providers.${providerID}.setCacheKey skipped (expected boolean)`)
  }
}

function mapProviderLists(providerID: string, providerConfig: Record<string, unknown>, plan: ImportPlan) {
  const whitelist = toStringArray(providerConfig.whitelist) ?? toStringArray(providerConfig.allowlist)
  if (whitelist) {
    setEdit(plan, ["provider", providerID, "whitelist"], whitelist)
    addMapped(plan, `provider.${providerID}.whitelist`)
  }
}

function mapProviderModels(providerID: string, providerConfig: Record<string, unknown>, plan: ImportPlan) {
  if (!isRecord(providerConfig.models)) return
  setEdit(plan, ["provider", providerID, "models"], providerConfig.models)
  addMapped(plan, `provider.${providerID}.models`)
}

function mapProviderBlock(providerRoot: Record<string, unknown>, plan: ImportPlan) {
  for (const [providerID, rawProviderConfig] of Object.entries(providerRoot)) {
    if (!isRecord(rawProviderConfig)) {
      addSkipped(plan, `providers.${providerID} skipped (expected object)`)
      addUnknown(plan, "provider", `providers.${providerID}`)
      continue
    }

    extractAuthInfo(providerID, rawProviderConfig, plan)
    mapProviderOptions(providerID, rawProviderConfig, plan)
    mapProviderLists(providerID, rawProviderConfig, plan)
    mapProviderModels(providerID, rawProviderConfig, plan)

    for (const key of Object.keys(rawProviderConfig)) {
      if (!PROVIDER_RECOGNIZED.has(key)) {
        addUnknown(plan, "provider", `providers.${providerID}.${key}`)
      }
    }
  }
}

function mapTopLevelConfig(input: Record<string, unknown>, plan: ImportPlan) {
  const logLevel = getStringFromKeys(input, ["logLevel"])
  if (logLevel) {
    setEdit(plan, ["logLevel"], logLevel)
    addMapped(plan, "logLevel")
  }

  const model = getStringFromKeys(input, ["model"])
  if (model) {
    setEdit(plan, ["model"], model)
    addMapped(plan, "model")
  }

  const smallModel = getStringFromKeys(input, ["small_model", "smallModel"])
  if (smallModel) {
    setEdit(plan, ["small_model"], smallModel)
    addMapped(plan, "small_model")
  }

  const disabledProviders = toStringArray(input.disabled_providers) ?? toStringArray(input.disabledProviders)
  if (disabledProviders) {
    setEdit(plan, ["disabled_providers"], disabledProviders)
    addMapped(plan, "disabled_providers")
  }

  const share = getStringFromKeys(input, ["share"])
  if (share) {
    setEdit(plan, ["share"], share)
    addMapped(plan, "share")
  }

  const autoupdate = input.autoupdate ?? input.autoUpdate
  if (typeof autoupdate === "boolean" || autoupdate === "notify") {
    setEdit(plan, ["autoupdate"], autoupdate)
    addMapped(plan, "autoupdate")
  } else if (autoupdate !== undefined) {
    addSkipped(plan, "autoupdate skipped (expected boolean|'notify')")
  }

  const username = getStringFromKeys(input, ["username"])
  if (username) {
    setEdit(plan, ["username"], username)
    addMapped(plan, "username")
  }
}

function mapModels(input: Record<string, unknown>, plan: ImportPlan) {
  if (!isRecord(input.models)) return
  const models = input.models

  const url = getStringFromKeys(models, ["url", "baseURL", "baseUrl"])
  if (url) {
    setEdit(plan, ["models", "url"], url)
    addMapped(plan, "models.url")
  }

  const modelPath = getStringFromKeys(models, ["path"])
  if (modelPath) {
    setEdit(plan, ["models", "path"], modelPath)
    addMapped(plan, "models.path")
  }

  for (const key of Object.keys(models)) {
    if (!["url", "baseURL", "baseUrl", "path"].includes(key)) {
      addUnknown(plan, "models", `models.${key}`)
    }
  }
}

function mapServer(input: Record<string, unknown>, plan: ImportPlan) {
  if (!isRecord(input.server)) return
  const server = input.server

  const port = server.port
  if (typeof port === "number" && Number.isInteger(port) && port > 0) {
    setEdit(plan, ["server", "port"], port)
    addMapped(plan, "server.port")
  } else if (port !== undefined) {
    addSkipped(plan, "server.port skipped (expected positive integer)")
  }

  const hostname = getStringFromKeys(server, ["hostname"])
  if (hostname) {
    setEdit(plan, ["server", "hostname"], hostname)
    addMapped(plan, "server.hostname")
  }

  const cors = toStringArray(server.cors)
  if (cors) {
    setEdit(plan, ["server", "cors"], cors)
    addMapped(plan, "server.cors")
  }

  const mdns = server.mdns
  if (typeof mdns === "boolean" || isRecord(mdns)) {
    setEdit(plan, ["server", "mdns"], mdns)
    addMapped(plan, "server.mdns")
  } else if (mdns !== undefined) {
    addSkipped(plan, "server.mdns skipped (expected boolean|object)")
  }

  const mdnsDomain = getStringFromKeys(server, ["mdnsDomain", "mdns_domain"])
  if (mdnsDomain) {
    setEdit(plan, ["server", "mdnsDomain"], mdnsDomain)
    addMapped(plan, "server.mdnsDomain")
  }

  for (const key of Object.keys(server)) {
    if (!["port", "hostname", "cors", "mdns", "mdnsDomain", "mdns_domain"].includes(key)) {
      addUnknown(plan, "server", `server.${key}`)
    }
  }
}

export function buildOpencodeImportPlan(raw: unknown): ImportPlan {
  const plan: ImportPlan = {
    configEdits: new Map(),
    authEntries: {},
    mapped: [],
    skipped: [],
    unknown: initUnknown(),
  }

  if (!isRecord(raw)) {
    addSkipped(plan, "root skipped (expected object)")
    return plan
  }

  mapTopLevelConfig(raw, plan)
  mapModels(raw, plan)
  mapServer(raw, plan)

  if (isRecord(raw.provider)) {
    mapProviderBlock(raw.provider, plan)
  }
  if (isRecord(raw.providers)) {
    mapProviderBlock(raw.providers, plan)
  }

  for (const key of Object.keys(raw)) {
    if (!ROOT_RECOGNIZED.has(key)) {
      addUnknown(plan, "topLevel", key)
    }
  }

  return plan
}

function defaultSourcePath(cwd: string): string {
  return path.join(cwd, ".opencode", "opencode.jsonc")
}

function defaultTargetConfigPath(cwd: string): string {
  return path.join(cwd, ".zee", "zee.jsonc")
}

function parseJsoncOrThrow(rawText: string, sourcePath: string): unknown {
  const errors: ParseError[] = []
  const parsed = parseJsonc(rawText, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (errors.length === 0) return parsed

  const first = errors[0]
  const code = first ? printParseErrorCode(first.error) : "unknown"
  const at = first ? `offset ${first.offset}` : "unknown offset"
  throw new Error(`Invalid JSONC in ${sourcePath}: ${code} (${at})`)
}

async function applyConfigEdits(targetPath: string, edits: Array<{ path: (string | number)[]; value: unknown }>) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const file = Bun.file(targetPath)
  let text = "{}"
  if (await file.exists()) {
    text = await file.text()
    if (text.trim().length === 0) text = "{}"
  }

  for (const edit of edits) {
    const patches = modify(text, edit.path, edit.value, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    text = applyEdits(text, patches)
  }

  await Bun.write(targetPath, text)
}

function displayPath(filepath: string): string {
  const homedir = os.homedir()
  return filepath.startsWith(homedir) ? filepath.replace(homedir, "~") : filepath
}

export async function importOpencodeConfig(options?: {
  file?: string
  cwd?: string
  dryRun?: boolean
}): Promise<OpencodeImportReport> {
  const cwd = options?.cwd ?? process.cwd()
  const sourcePath = path.resolve(cwd, options?.file ?? defaultSourcePath(cwd))
  const targetConfigPath = defaultTargetConfigPath(cwd)
  const dryRun = Boolean(options?.dryRun)

  const sourceFile = Bun.file(sourcePath)
  if (!(await sourceFile.exists())) {
    throw new Error(
      `OpenCode config not found at ${sourcePath}. Provide a file path or add .opencode/opencode.jsonc in this project.`,
    )
  }

  const parsed = parseJsoncOrThrow(await sourceFile.text(), sourcePath)
  const plan = buildOpencodeImportPlan(parsed)
  const configEdits = [...plan.configEdits.values()]
  const authEntries = Object.entries(plan.authEntries)

  if (!dryRun) {
    if (configEdits.length > 0) {
      await applyConfigEdits(targetConfigPath, configEdits)
    }
    for (const [providerID, info] of authEntries) {
      await Auth.set(providerID, info)
    }
  }

  return {
    sourcePath,
    targetConfigPath,
    dryRun,
    mapped: [...plan.mapped],
    skipped: [...plan.skipped],
    unknown: plan.unknown,
    authProviders: authEntries.map(([providerID]) => providerID),
    configEditCount: configEdits.length,
  }
}

export const AuthImportOpenCodeCommand = cmd({
  command: "import-opencode [file]",
  describe: "import auth/provider config from .opencode/opencode.jsonc into Zee config",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "path to opencode.jsonc (defaults to .opencode/opencode.jsonc)",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "show import plan without writing .zee/zee.jsonc or auth entries",
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Import OpenCode Auth/Provider Config")

    const report = await importOpencodeConfig({
      file: typeof args.file === "string" ? args.file : undefined,
      dryRun: Boolean(args.dryRun),
    })

    prompts.log.info(`source: ${UI.Style.TEXT_DIM}${displayPath(report.sourcePath)}${UI.Style.TEXT_NORMAL}`)
    prompts.log.info(`target: ${UI.Style.TEXT_DIM}${displayPath(report.targetConfigPath)}${UI.Style.TEXT_NORMAL}`)
    prompts.log.info(
      `mapped: ${report.mapped.length}, config edits: ${report.configEditCount}, auth entries: ${report.authProviders.length}`,
    )

    if (report.mapped.length > 0) {
      const preview = report.mapped.slice(0, 12)
      prompts.log.info(`mapped keys: ${preview.join(", ")}${report.mapped.length > preview.length ? ", ..." : ""}`)
    }

    if (report.skipped.length > 0) {
      prompts.log.warn(`skipped: ${report.skipped.length}`)
      for (const item of report.skipped.slice(0, 12)) {
        prompts.log.info(`  - ${item}`)
      }
    }

    for (const category of Object.keys(report.unknown) as UnknownCategory[]) {
      const items = report.unknown[category]
      if (items.length === 0) continue
      prompts.log.warn(`${category}: ${items.length} unknown key(s)`)
      for (const item of items.slice(0, 8)) {
        prompts.log.info(`  - ${item}`)
      }
      prompts.log.info(`  remediation: ${IMPORT_REMEDIATION[category]}`)
    }

    if (report.dryRun) {
      prompts.outro("Dry run complete (no files were modified).")
      return
    }

    prompts.outro("Import complete.")
  },
})
