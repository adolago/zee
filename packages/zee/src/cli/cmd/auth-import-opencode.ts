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

export type OpencodeImportResult = {
  sourcePath: string
  targetPath: string
  mapped: string[]
  skipped: string[]
  dryRun: boolean
}

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

  const refresh = asString(entry.refresh)
  const access = asString(entry.access)
  const expires = asNumber(entry.expires)
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
    asString(entry.apiKey) ??
    asString(entry.key) ??
    asString(entry.token) ??
    asString(entry.accessToken)
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
  return asString(options?.baseURL) ?? asString(options?.baseUrl) ?? asString(entry.baseURL) ?? asString(entry.baseUrl)
}

function buildImportPlan(source: JsonObject) {
  const mapped: string[] = []
  const skipped: string[] = []
  const configEdits: ImportConfigEdit[] = []
  const credentials = new Map<string, ImportCredential>()

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

      if (!entryMapped) {
        skipped.push(`${container.label}.${providerID}: no supported auth/baseURL fields`)
      }
    }
  }

  const models = asRecord(source.models)
  if (models) {
    const url = asString(models.url)
    const modelsPath = asString(models.path)
    if (url) {
      configEdits.push({ path: ["models", "url"], value: url, source: "models.url" })
      mapped.push("models.url -> models.url")
    }
    if (modelsPath) {
      configEdits.push({ path: ["models", "path"], value: modelsPath, source: "models.path" })
      mapped.push("models.path -> models.path")
    }
  }

  const server = asRecord(source.server)
  if (server) {
    if (typeof server.mdns === "boolean") {
      configEdits.push({ path: ["server", "mdns"], value: server.mdns, source: "server.mdns" })
      mapped.push("server.mdns -> server.mdns")
    }
    const mdnsDomain = asString(server.mdnsDomain) ?? asString(server["mdns-domain"])
    if (mdnsDomain) {
      configEdits.push({ path: ["server", "mdnsDomain"], value: mdnsDomain, source: "server.mdnsDomain" })
      mapped.push("server.mdnsDomain -> server.mdnsDomain")
    }
  }

  const recognizedTopLevelKeys = new Set(["$schema", "provider", "providers", "auth", "models", "server"])
  for (const key of Object.keys(source)) {
    if (!recognizedTopLevelKeys.has(key)) {
      skipped.push(`${key}: unsupported top-level key`)
    }
  }

  return {
    mapped,
    skipped,
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

    if (result.dryRun) {
      prompts.outro("Dry run complete")
      return
    }

    prompts.outro("Import complete")
  },
})
