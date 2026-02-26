import path from "path"
import fs from "fs/promises"
import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { Auth } from "../../auth"
import { applyEdits, modify, parse as parseJsonc, printParseErrorCode, type ParseError as JsoncParseError } from "jsonc-parser"

const OPENCODE_CONFIG_CANDIDATES = [".opencode/opencode.jsonc", ".opencode/opencode.json"] as const
const CONFIG_FORMAT = { formattingOptions: { tabSize: 2, insertSpaces: true } }

type JsonObject = Record<string, unknown>

type ImportCredential = {
  providerID: string
  info: Auth.Info
  source: string
}

type ImportConfigEdit = {
  path: string[]
  value: unknown
  source: string
}

export type OpencodeUnknownCategory = "topLevel" | "provider" | "models" | "server"

export type OpencodeUnknownDiagnostics = {
  categories: Array<{
    category: OpencodeUnknownCategory
    keys: string[]
    hint: string
  }>
}

export type OpencodeImportResult = {
  sourcePath: string
  targetPath: string
  mapped: string[]
  skipped: string[]
  unknown: OpencodeUnknownDiagnostics
  dryRun: boolean
}

type BuildImportPlanResult = {
  mapped: string[]
  skipped: string[]
  unknown: OpencodeUnknownDiagnostics
  configEdits: ImportConfigEdit[]
  credentials: ImportCredential[]
}

const UNKNOWN_HINTS: Record<OpencodeUnknownCategory, string> = {
  topLevel:
    "OpenCode-only top-level keys are not auto-imported. Move compatible values into .zee/zee.jsonc manually if needed.",
  provider:
    "Provider keys outside auth/baseURL/timeout/cache/allowlist/denylist need manual review under provider.<id> or provider.<id>.options.",
  models: "Only models.url and models.path are imported. Migrate additional model keys manually into Zee config if required.",
  server:
    "Only server.mdns, server.mdnsDomain, server.port, server.hostname, and server.cors are imported. Review other server keys manually.",
}

const UNKNOWN_CATEGORY_ORDER: OpencodeUnknownCategory[] = ["topLevel", "provider", "models", "server"]

function asRecord(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length === 0) return []
  const items = value.map((item) => asString(item)).filter((item): item is string => item !== undefined)
  return items.length > 0 ? items : undefined
}

function asPositiveInt(value: unknown): number | undefined {
  const number = asNumber(value)
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined
}

function asProviderTimeout(value: unknown): number | false | undefined {
  if (value === false) return false
  const number = asPositiveInt(value)
  return number !== undefined ? number : undefined
}

function asShareMode(value: unknown): "manual" | "auto" | "disabled" | undefined {
  return value === "manual" || value === "auto" || value === "disabled" ? value : undefined
}

function asAutoupdate(value: unknown): boolean | "notify" | undefined {
  if (value === "notify") return value
  return asBoolean(value)
}

function buildUnknownDiagnostics(unknownKeys: Map<OpencodeUnknownCategory, Set<string>>): OpencodeUnknownDiagnostics {
  const categories = UNKNOWN_CATEGORY_ORDER.flatMap((category) => {
    const keys = [...(unknownKeys.get(category) ?? [])].sort()
    if (keys.length === 0) return []
    return [
      {
        category,
        keys,
        hint: UNKNOWN_HINTS[category],
      },
    ]
  })

  return { categories }
}

function formatJsoncErrors(text: string, errors: JsoncParseError[]) {
  return errors
    .map((error) => {
      const before = text.slice(0, error.offset).split("\n")
      const line = before.length
      const column = before[before.length - 1].length + 1
      return `${printParseErrorCode(error.error)} at line ${line}, column ${column}`
    })
    .join("; ")
}

async function resolveOpencodeConfigPath(cwd: string, explicitPath?: string) {
  if (explicitPath) {
    const resolved = path.resolve(cwd, explicitPath)
    if (await Bun.file(resolved).exists()) return resolved
    throw new Error(`OpenCode config file not found: ${resolved}`)
  }

  for (const relativePath of OPENCODE_CONFIG_CANDIDATES) {
    const candidate = path.join(cwd, relativePath)
    if (await Bun.file(candidate).exists()) return candidate
  }

  throw new Error(
    `No OpenCode config found. Expected one of: ${OPENCODE_CONFIG_CANDIDATES.map((x) => path.join(cwd, x)).join(", ")}`,
  )
}

async function readOpencodeConfig(sourcePath: string): Promise<JsonObject> {
  const text = await Bun.file(sourcePath).text()
  const errors: JsoncParseError[] = []
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    throw new Error(`Invalid OpenCode JSONC (${sourcePath}): ${formatJsoncErrors(text, errors)}`)
  }
  const record = asRecord(parsed)
  if (!record) throw new Error(`OpenCode config must be an object: ${sourcePath}`)
  return record
}

function extractCredential(entryValue: unknown): Auth.Info | undefined {
  const entry = asRecord(entryValue)
  if (!entry) {
    const inlineKey = asString(entryValue)
    return inlineKey ? { type: "api", key: inlineKey } : undefined
  }

  const refresh = asString(entry.refresh) ?? asString(entry.refreshToken) ?? asString(entry.refresh_token)
  const access = asString(entry.access) ?? asString(entry.accessToken) ?? asString(entry.access_token)
  const expires = asNumber(entry.expires) ?? asNumber(entry.expiresAt) ?? asNumber(entry.expires_at)
  if (refresh && access && expires !== undefined) {
    return {
      type: "oauth",
      refresh,
      access,
      expires,
    }
  }

  const options = asRecord(entry.options)
  const apiKey =
    asString(options?.apiKey) ??
    asString(options?.key) ??
    asString(options?.token) ??
    asString(options?.accessToken) ??
    asString(options?.api_key) ??
    asString(entry.apiKey) ??
    asString(entry.key) ??
    asString(entry.token) ??
    asString(entry.accessToken) ??
    asString(entry.api_key)
  if (!apiKey) return undefined

  return {
    type: "api",
    key: apiKey,
  }
}

function extractBaseUrl(entryValue: unknown): string | undefined {
  const entry = asRecord(entryValue)
  if (!entry) return undefined
  const options = asRecord(entry.options)
  return (
    asString(options?.baseURL) ??
    asString(options?.baseUrl) ??
    asString(options?.base_url) ??
    asString(entry.baseURL) ??
    asString(entry.baseUrl) ??
    asString(entry.base_url)
  )
}

function buildImportPlan(source: JsonObject): BuildImportPlanResult {
  const mapped: string[] = []
  const skipped: string[] = []
  const configEdits: ImportConfigEdit[] = []
  const credentials = new Map<string, ImportCredential>()
  const unknownKeys = new Map<OpencodeUnknownCategory, Set<string>>(
    UNKNOWN_CATEGORY_ORDER.map((category) => [category, new Set<string>()]),
  )

  const addUnknownKey = (category: OpencodeUnknownCategory, key: string) => {
    unknownKeys.get(category)?.add(key)
  }

  const providerContainers: Array<{ label: string; value: unknown }> = [
    { label: "provider", value: source.provider },
    { label: "providers", value: source.providers },
    { label: "auth", value: source.auth },
  ]

  for (const container of providerContainers) {
    const entries = asRecord(container.value)
    if (!entries) continue
    for (const [providerID, rawEntry] of Object.entries(entries)) {
      let entryMapped = false

      const credential = extractCredential(rawEntry)
      if (credential) {
        if (!credentials.has(providerID)) {
          credentials.set(providerID, {
            providerID,
            info: credential,
            source: `${container.label}.${providerID}`,
          })
          mapped.push(`${container.label}.${providerID} -> auth.${providerID}`)
        } else {
          skipped.push(`${container.label}.${providerID}: credential already mapped from higher-priority source`)
        }
        entryMapped = true
      }

      const baseURL = extractBaseUrl(rawEntry)
      if (baseURL) {
        configEdits.push({
          path: ["provider", providerID, "options", "baseURL"],
          value: baseURL,
          source: `${container.label}.${providerID}.baseURL`,
        })
        mapped.push(`${container.label}.${providerID}.baseURL -> provider.${providerID}.options.baseURL`)
        entryMapped = true
      }

      const entry = asRecord(rawEntry)
      const options = asRecord(entry?.options)
      if (container.label !== "auth") {
        const timeout = asProviderTimeout(options?.timeout ?? entry?.timeout)
        if (timeout !== undefined) {
          configEdits.push({
            path: ["provider", providerID, "options", "timeout"],
            value: timeout,
            source: `${container.label}.${providerID}.timeout`,
          })
          mapped.push(`${container.label}.${providerID}.timeout -> provider.${providerID}.options.timeout`)
          entryMapped = true
        }

        const setCacheKey = asBoolean(options?.setCacheKey ?? entry?.setCacheKey)
        if (setCacheKey !== undefined) {
          configEdits.push({
            path: ["provider", providerID, "options", "setCacheKey"],
            value: setCacheKey,
            source: `${container.label}.${providerID}.setCacheKey`,
          })
          mapped.push(`${container.label}.${providerID}.setCacheKey -> provider.${providerID}.options.setCacheKey`)
          entryMapped = true
        }

        const enterpriseUrl = asString(options?.enterpriseUrl ?? entry?.enterpriseUrl)
        if (enterpriseUrl) {
          configEdits.push({
            path: ["provider", providerID, "options", "enterpriseUrl"],
            value: enterpriseUrl,
            source: `${container.label}.${providerID}.enterpriseUrl`,
          })
          mapped.push(`${container.label}.${providerID}.enterpriseUrl -> provider.${providerID}.options.enterpriseUrl`)
          entryMapped = true
        }

        const whitelist = asStringArray(entry?.whitelist)
        if (whitelist !== undefined) {
          configEdits.push({
            path: ["provider", providerID, "whitelist"],
            value: whitelist,
            source: `${container.label}.${providerID}.whitelist`,
          })
          mapped.push(`${container.label}.${providerID}.whitelist -> provider.${providerID}.whitelist`)
          entryMapped = true
        }

        const blacklist = asStringArray(entry?.blacklist)
        if (blacklist !== undefined) {
          configEdits.push({
            path: ["provider", providerID, "blacklist"],
            value: blacklist,
            source: `${container.label}.${providerID}.blacklist`,
          })
          mapped.push(`${container.label}.${providerID}.blacklist -> provider.${providerID}.blacklist`)
          entryMapped = true
        }

        const providerModels = asRecord(entry?.models)
        if (providerModels) {
          configEdits.push({
            path: ["provider", providerID, "models"],
            value: providerModels,
            source: `${container.label}.${providerID}.models`,
          })
          mapped.push(`${container.label}.${providerID}.models -> provider.${providerID}.models`)
          entryMapped = true
        }
      }

      if (entry) {
        const recognizedEntryKeys = new Set([
          "type",
          "options",
          "refresh",
          "access",
          "expires",
          "refreshToken",
          "accessToken",
          "expiresAt",
          "refresh_token",
          "access_token",
          "expires_at",
          "apiKey",
          "api_key",
          "key",
          "token",
          "baseURL",
          "baseUrl",
          "base_url",
          "timeout",
          "setCacheKey",
          "enterpriseUrl",
          "whitelist",
          "blacklist",
          "models",
        ])
        for (const key of Object.keys(entry)) {
          if (!recognizedEntryKeys.has(key)) {
            addUnknownKey("provider", `${container.label}.${providerID}.${key}`)
          }
        }

        if ("options" in entry && entry.options !== undefined && !options) {
          addUnknownKey("provider", `${container.label}.${providerID}.options`)
        }

        if (options) {
          const recognizedOptionKeys = new Set([
            "apiKey",
            "api_key",
            "key",
            "token",
            "accessToken",
            "baseURL",
            "baseUrl",
            "base_url",
            "timeout",
            "setCacheKey",
            "enterpriseUrl",
          ])
          for (const key of Object.keys(options)) {
            if (!recognizedOptionKeys.has(key)) {
              addUnknownKey("provider", `${container.label}.${providerID}.options.${key}`)
            }
          }
        }
      }

      if (!entryMapped) {
        skipped.push(`${container.label}.${providerID}: no supported auth/baseURL fields`)
      }
    }
  }

  const models = asRecord(source.models)
  if (models) {
    const url = asString(models.url) ?? asString(models.baseURL) ?? asString(models.baseUrl)
    const modelsPath = asString(models.path)
    if (url) {
      configEdits.push({ path: ["models", "url"], value: url, source: "models.url" })
      if (asString(models.url)) mapped.push("models.url -> models.url")
      else if (asString(models.baseURL)) mapped.push("models.baseURL -> models.url")
      else mapped.push("models.baseUrl -> models.url")
    }
    if (modelsPath) {
      configEdits.push({ path: ["models", "path"], value: modelsPath, source: "models.path" })
      mapped.push("models.path -> models.path")
    }

    const recognizedModelsKeys = new Set(["url", "path", "baseURL", "baseUrl"])
    for (const key of Object.keys(models)) {
      if (!recognizedModelsKeys.has(key)) {
        addUnknownKey("models", `models.${key}`)
      }
    }
  }

  const server = asRecord(source.server)
  if (server) {
    const mdns = asBoolean(server.mdns)
    if (mdns !== undefined) {
      configEdits.push({ path: ["server", "mdns"], value: mdns, source: "server.mdns" })
      mapped.push("server.mdns -> server.mdns")
    }
    const mdnsDomain = asString(server.mdnsDomain) ?? asString(server["mdns-domain"])
    if (mdnsDomain) {
      configEdits.push({ path: ["server", "mdnsDomain"], value: mdnsDomain, source: "server.mdnsDomain" })
      mapped.push("server.mdnsDomain -> server.mdnsDomain")
    }

    const port = asPositiveInt(server.port)
    if (port !== undefined) {
      configEdits.push({ path: ["server", "port"], value: port, source: "server.port" })
      mapped.push("server.port -> server.port")
    }

    const hostname = asString(server.hostname)
    if (hostname) {
      configEdits.push({ path: ["server", "hostname"], value: hostname, source: "server.hostname" })
      mapped.push("server.hostname -> server.hostname")
    }

    const cors = asStringArray(server.cors)
    if (cors !== undefined) {
      configEdits.push({ path: ["server", "cors"], value: cors, source: "server.cors" })
      mapped.push("server.cors -> server.cors")
    }

    const recognizedServerKeys = new Set(["mdns", "mdnsDomain", "mdns-domain", "port", "hostname", "cors"])
    for (const key of Object.keys(server)) {
      if (!recognizedServerKeys.has(key)) {
        addUnknownKey("server", `server.${key}`)
      }
    }
  }

  const logLevel = asString(source.logLevel)
  if (logLevel) {
    configEdits.push({ path: ["logLevel"], value: logLevel, source: "logLevel" })
    mapped.push("logLevel -> logLevel")
  }

  const model = asString(source.model)
  if (model) {
    configEdits.push({ path: ["model"], value: model, source: "model" })
    mapped.push("model -> model")
  }

  const smallModel = asString(source.small_model)
  if (smallModel) {
    configEdits.push({ path: ["small_model"], value: smallModel, source: "small_model" })
    mapped.push("small_model -> small_model")
  }

  const disabledProviders = asStringArray(source.disabled_providers)
  if (disabledProviders !== undefined) {
    configEdits.push({ path: ["disabled_providers"], value: disabledProviders, source: "disabled_providers" })
    mapped.push("disabled_providers -> disabled_providers")
  }

  const share = asShareMode(source.share)
  if (share) {
    configEdits.push({ path: ["share"], value: share, source: "share" })
    mapped.push("share -> share")
  }

  const autoupdate = asAutoupdate(source.autoupdate)
  if (autoupdate !== undefined) {
    configEdits.push({ path: ["autoupdate"], value: autoupdate, source: "autoupdate" })
    mapped.push("autoupdate -> autoupdate")
  }

  const username = asString(source.username)
  if (username) {
    configEdits.push({ path: ["username"], value: username, source: "username" })
    mapped.push("username -> username")
  }

  const recognizedTopLevelKeys = new Set([
    "$schema",
    "provider",
    "providers",
    "auth",
    "models",
    "server",
    "logLevel",
    "model",
    "small_model",
    "disabled_providers",
    "share",
    "autoupdate",
    "username",
  ])
  for (const key of Object.keys(source)) {
    if (!recognizedTopLevelKeys.has(key)) {
      skipped.push(`${key}: unsupported top-level key`)
      addUnknownKey("topLevel", key)
    }
  }

  return {
    mapped,
    skipped,
    unknown: buildUnknownDiagnostics(unknownKeys),
    configEdits,
    credentials: [...credentials.values()],
  }
}

async function applyConfigEdits(targetPath: string, edits: ImportConfigEdit[]) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })

  let text = "{}"
  const targetFile = Bun.file(targetPath)
  if (await targetFile.exists()) {
    text = await targetFile.text()
  }

  const schemaEdits = modify(text, ["$schema"], "zee", CONFIG_FORMAT)
  text = applyEdits(text, schemaEdits)

  for (const edit of edits) {
    const jsonEdits = modify(text, edit.path, edit.value, CONFIG_FORMAT)
    text = applyEdits(text, jsonEdits)
  }

  await Bun.write(targetPath, text)
}

export async function importOpencodeConfig(options: {
  cwd: string
  file?: string
  dryRun?: boolean
}): Promise<OpencodeImportResult> {
  const sourcePath = await resolveOpencodeConfigPath(options.cwd, options.file)
  const source = await readOpencodeConfig(sourcePath)
  const plan = buildImportPlan(source)
  const targetPath = path.join(options.cwd, ".zee", "zee.jsonc")
  const dryRun = options.dryRun === true

  if (!dryRun) {
    await applyConfigEdits(targetPath, plan.configEdits)
    for (const credential of plan.credentials) {
      await Auth.set(credential.providerID, credential.info)
    }
  }

  return {
    sourcePath,
    targetPath,
    mapped: plan.mapped,
    skipped: plan.skipped,
    unknown: plan.unknown,
    dryRun,
  }
}

export const AuthImportOpencodeCommand = cmd({
  command: "import-opencode [file]",
  describe: "import OpenCode credentials/config from .opencode into Zee",
  builder: (yargs) =>
    yargs
      .positional("file", {
        describe: "path to an OpenCode config file (defaults to .opencode/opencode.jsonc)",
        type: "string",
      })
      .option("dry-run", {
        describe: "show mappings without writing config or credentials",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    prompts.intro("Import OpenCode config")

    const result = await importOpencodeConfig({
      cwd: process.cwd(),
      file: typeof args.file === "string" ? args.file : undefined,
      dryRun: args["dry-run"] === true,
    })

    prompts.log.info(`Source: ${result.sourcePath}`)
    prompts.log.info(`Destination: ${result.targetPath}`)

    if (result.mapped.length === 0) {
      prompts.log.warn("No supported fields found to import")
    } else {
      prompts.log.success(`Mapped ${result.mapped.length} field${result.mapped.length === 1 ? "" : "s"}`)
    }

    if (result.skipped.length > 0) {
      prompts.log.info(`Skipped ${result.skipped.length} field${result.skipped.length === 1 ? "" : "s"}`)
    }

    if (result.unknown.categories.length > 0) {
      prompts.log.warn(
        `Found ${result.unknown.categories.length} unknown key categor${result.unknown.categories.length === 1 ? "y" : "ies"}`,
      )
      for (const category of result.unknown.categories) {
        prompts.log.info(`${category.category}: ${category.keys.length} key${category.keys.length === 1 ? "" : "s"}`)
        prompts.log.info(`Hint: ${category.hint}`)
      }
    }

    if (result.dryRun) {
      prompts.outro("Dry run complete")
      return
    }

    prompts.outro("Import complete")
  },
})
